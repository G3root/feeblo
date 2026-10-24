import { fileURLToPath } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const paraglideProjectDir = fileURLToPath(
  new URL("../../project.inlang", import.meta.url)
);

const isCloudflareAdapter = process.env.CLOUDFLARE_ADAPTER === "true";
const tanstackPackageRegex = /\/@tanstack\/([^/]+)/;

/**
 * The dashboard app on TanStack Start.
 *
 * The app is one Start (React) deployment. The feedback widget's iframe is a
 * server-only route that serves a hand-written HTML shell; its Solid bundle is
 * built separately (`packages/feedback-widget/vite.config.iframe.ts`) into
 * `public/widget`, because Start's client environment allows exactly one
 * entry. The public board's pages are ordinary SSR routes under `/s/...`,
 * rendered from components in `@feeblo/public-feature-board`.
 *
 * Cloudflare and Node builds share this config; `CLOUDFLARE_ADAPTER` picks the
 * hosting plugin (the Node path is served by `server.mjs`, which pairs srvx
 * with the `dist/server` fetch handler).
 */
/**
 * Hints the entry chunk's whole static module graph, not just its first level.
 *
 * TanStack Start records a route's chunks one level deep — the route's chunk
 * plus that chunk's direct imports (`start-manifest-plugin/manifestBuilder`,
 * `getChunkPreloads`) — and the document renders exactly those as
 * `<link rel="modulepreload">`. The entry chunk imports the shared chunk, which
 * imports the vendor chunks the entry never names, so the browser only
 * discovers them after downloading and parsing the shared chunk: ~180 kB of
 * brotli in a second round trip ahead of hydration on every first visit.
 *
 * This walks the client build's chunk graph and appends the entry's closure to
 * `__root__`'s preloads, which every document emits. Nothing extra ships — the
 * browser fetches that graph before the route can render anyway — it just
 * starts fetching it in parallel with the entry.
 *
 * Deliberately scoped to `__root__`. Expanding *every* route to its own closure
 * put the same files in a parent's and its children's lists — the generated
 * manifest has already deduplicated them once by then — and the resulting
 * duplicate `<link>` elements made React discard hydration for the whole
 * document (`Minified React error #418`, reproduced by the public board's
 * "guest's comments" e2e). The leftover second-level chunks are small leaf
 * modules (a few kB per route), so the root scope is where the win is.
 *
 * The transform fails the build when the generated manifest no longer has the
 * shape it edits: a silent no-op here would bring the extra round trip back
 * with nothing to say so.
 */
function eagerPreloadHints(): Plugin {
  let importsByHref: ReadonlyMap<string, ReadonlyArray<string>> = new Map();

  return {
    name: "eager-preload-hints",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      if (this.environment.name !== "client") {
        return;
      }

      const base = this.environment.config.base;
      const graph = new Map<string, ReadonlyArray<string>>();

      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== "chunk") {
          continue;
        }

        graph.set(
          `${base}${fileName}`,
          output.imports.map((imported) => `${base}${imported}`)
        );
      }

      importsByHref = graph;
    },
    transform(code, id) {
      if (this.environment.name !== "ssr") {
        return null;
      }

      if (!id.includes("tanstack-start-manifest")) {
        return null;
      }

      if (importsByHref.size === 0) {
        this.error(
          "eager-preload-hints: the server build started before the client build published its chunk graph"
        );
      }

      const rootPreloads =
        /(__root__:\s*\{[\s\S]*?preloads:\s*\[)([\s\S]*?)(\])/;

      if (!rootPreloads.test(code)) {
        this.error(
          "eager-preload-hints: the generated route manifest has no `__root__` preloads array any more; update this plugin for its new shape"
        );
      }

      const graph = importsByHref;
      const next = code.replace(
        rootPreloads,
        (_whole, head: string, body: string, tail: string) => {
          const declared = [...body.matchAll(/"([^"]+)"/g)].map(
            // SAFETY: the pattern captures one group, so index 1 exists.
            (match) => match[1] as string
          );
          const closure = new Set(declared);
          const queue = [...declared];

          for (let href = queue.pop(); href !== undefined; href = queue.pop()) {
            for (const imported of graph.get(href) ?? []) {
              if (!closure.has(imported)) {
                closure.add(imported);
                queue.push(imported);
              }
            }
          }

          const added = [...closure]
            .filter((href) => !declared.includes(href))
            .sort()
            .map((href) => `\n\t\t\t${JSON.stringify(href)},`)
            .join("");

          // The generated array has no trailing comma, so the first addition
          // needs its own separator.
          const trimmed = body.trimEnd();
          const separator =
            trimmed.length === 0 || trimmed.endsWith(",") ? "" : ",";

          return `${head}${trimmed}${separator}${added}\n\t\t${tail}`;
        }
      );

      // The closure above overlaps the shared chunks TanStack already lists on
      // child routes (`/s` names the router and query vendors too). Emitting
      // both sets puts duplicate `<link rel="modulepreload">` elements in the
      // document; React sees the repeated meta keys when hydrating and discards
      // hydration for the page (error #418). Keep the first occurrence — the
      // root array, which is generated first — and drop later repeats.
      const seen = new Set<string>();
      const deduped = next.replace(
        /(preloads:\s*\[)([\s\S]*?)(\])/g,
        (_whole, head: string, body: string, tail: string) => {
          const kept = [...body.matchAll(/"([^"]+)"/g)]
            .map(
              // SAFETY: the pattern captures one group, so index 1 exists.
              (match) => match[1] as string
            )
            .filter((href) => {
              if (seen.has(href)) {
                return false;
              }
              seen.add(href);
              return true;
            });
          const entries = kept
            .map((href) => `\n\t\t\t${JSON.stringify(href)},`)
            .join("");

          return `${head}${entries}\n\t\t${tail}`;
        }
      );

      return { code: deduped, map: null };
    },
  };
}

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    proxy: {
      // Dev only: the browser reaches the API through this same-origin proxy
      // (API_URL is injected as "/api" in dev, see the root env script) so
      // auth cookies are set first-party even on *.localhost subdomains.
      // Without it, every *.localhost site is a distinct site from
      // localhost:3000, and privacy browsers (Helium, third-party-cookie
      // blocking) silently drop the cross-site session cookie, breaking
      // sign-in on public boards. Most client paths already carry the API's
      // full /api/... route and pass through unchanged; only the widget's
      // double-prefixed URL and the RPC prefix need rewriting.
      "/api": {
        target: process.env.API_URL ?? "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => {
          // The feedback widget builds `${apiUrl}//api/widget/v1/...`; drop the
          // redundant /api prefix plus the doubled slash, forwarding
          // /api/widget/... exactly like the direct API call does.
          if (path.startsWith("/api//api/")) {
            return path.slice("/api/".length);
          }
          // The RPC client prefixes its /rpc endpoint with the API base.
          if (path === "/api/rpc" || path === "/api/rpc/") {
            return path.slice("/api".length);
          }
          // Everything else (better-auth /api/auth/*, uploads, verification
          // OTP) already carries the API's full path — pass it through.
          return path;
        },
      },
    },
    warmup: {
      clientFiles: ["./src/router.tsx", "./src/routeTree.gen.ts"],
      ssrFiles: ["./src/server.ts"],
    },
  },
  plugins: [
    ...(isCloudflareAdapter
      ? [cloudflare({ viteEnvironment: { name: "ssr" } })]
      : []),
    paraglideVitePlugin({
      project: paraglideProjectDir,
      outdir: "./src/paraglide",
      emitTsDeclarations: true,
      strategy: ["cookie", "baseLocale"],
    }),
    {
      name: "fix-hugeicons-pure-annotations",
      enforce: "pre",
      transform(code, id) {
        if (
          !(
            id.includes("/@hugeicons/core-free-icons/") &&
            code.includes("/*#__PURE__*/")
          )
        ) {
          return null;
        }

        return {
          code: code.replaceAll("/*#__PURE__*/ ", ""),
          map: null,
        };
      },
    },
    tanstackStart({
      router: {
        routesDirectory: "routes",
        generatedRouteTree: "routeTree.gen.ts",
        routeFileIgnorePrefix: "-",
        quoteStyle: "double",
      },
      dev: {
        // Start's dev-only SSR styles aggregation (`/@tanstack-start/styles.css?routes=…`)
        // crawls the module graph during the render, so the sheet the first paint
        // uses is nondeterministic: it can miss the responsive rules entirely, and
        // once the graph is warm it appends the unprocessed `tailwindcss/index.css`
        // *after* the compiled sheet — its default `.hidden` then wins the cascade
        // over `.lg\:flex`, so the board's right sidebar renders hidden and the
        // page paints "zoomed in" until hydration injects the real CSS.
        // `__root.tsx` links the compiled stylesheet directly instead, and Vite
        // serves that URL as plain CSS for the `<link>` request.
        ssrStyles: { enabled: false },
      },
    }),
    viteReact(),
    tailwindcss(),
    eagerPreloadHints(),
  ],
  ssr: {
    noExternal: [/^@feeblo\//],
  },
  build: {
    chunkSizeWarningLimit: 750,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/")
          ) {
            return "vendor-react";
          }

          if (id.includes("/@hugeicons")) {
            return "hugeicons-vendor";
          }

          if (id.includes("/node_modules/dayjs/")) {
            return "dayjs-vendor";
          }

          if (id.includes("/node_modules/effect/dist/")) {
            return "effect-runtime-vendor";
          }

          if (id.includes("/@tanstack/")) {
            const match = tanstackPackageRegex.exec(id);
            if (match) {
              const name = match[1];
              // react-store and react-router have a circular dependency,
              // so keep them in the same chunk to avoid circular chunk warnings.
              if (name === "react-store") {
                return "tanstack-react-router-vendor";
              }
              // form-core is only used through @tanstack/react-form; putting it
              // in its own chunk leaves an empty chunk after tree-shaking.
              if (name === "form-core") {
                return "tanstack-react-form-vendor";
              }
              // Thin re-export / leaf wrappers: co-locate each with the chunk it
              // actually shares code with, so tree-shaking doesn't leave
              // near-empty chunks and extra requests on the dashboard.
              if (name === "react-query") {
                return "tanstack-query-core-vendor";
              }
              if (name === "react-db") {
                return "tanstack-db-vendor";
              }
              if (name === "history") {
                return "tanstack-react-router-vendor";
              }
              // Keep the Pacer packages together in their own vendor chunk
              // instead of coupling them to the router vendor.
              if (
                name === "react-pacer" ||
                name === "pacer" ||
                name === "devtools-event-client"
              ) {
                return "pacer-vendor";
              }
              return `tanstack-${name}-vendor`;
            }
          }

          if (id.includes("/@base-ui/")) {
            return "base-ui-vendor";
          }

          if (id.includes("/zod/")) {
            return "zod-vendor";
          }

          if (id.includes("/@dnd-kit/")) {
            return "dnd-kit-vendor";
          }

          if (id.includes("/@xstate/store")) {
            return "xstate-store-vendor";
          }

          if (id.includes("/@floating-ui/")) {
            return "floating-ui-vendor";
          }

          if (id.includes("/better-auth/") || id.includes("/@better-auth/")) {
            return "better-auth-vendor";
          }

          if (id.includes("/posthog-js/")) {
            return "posthog-vendor";
          }

          if (id.includes("/dompurify/")) {
            return "dompurify-vendor";
          }

          if (
            id.includes("/prosemirror-") ||
            id.includes("/prosekit/") ||
            id.includes("/mdast-util-to-markdown/") ||
            id.includes("/unist-util-visit-parents/") ||
            id.includes("/unified/") ||
            id.includes("/hast-") ||
            id.includes("/rehype-") ||
            id.includes("/remark-")
          ) {
            return "editor-vendor";
          }

          return undefined;
        },
      },
    },
  },
});
