import { fileURLToPath } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
 * entry. The public board is a normal route that renders on the server for
 * crawlers and hands off to its own client-only SPA after hydration.
 *
 * Cloudflare and Node builds share this config; `CLOUDFLARE_ADAPTER` picks the
 * hosting plugin (the Node path is served by `server.mjs`, which pairs srvx
 * with the `dist/server` fetch handler).
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // The tsconfig maps this specifier to a boundary declaration for
      // typechecking (see `types/public-feature-board.d.ts`); the real
      // package is what must be bundled.
      "@feeblo/public-feature-board": fileURLToPath(
        new URL("../../apps/public-feature-board/src/index.ts", import.meta.url)
      ),
    },
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
    }),
    viteReact(),
    tailwindcss(),
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
            id.includes("/katex/") ||
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
