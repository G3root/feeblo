// @ts-check

import cloudflare from "@astrojs/cloudflare";
import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
// import alchemy from "alchemy/cloudflare/astro";
import { defineConfig, envField, fontProviders } from "astro/config";

const isCloudflareAdapter = process.env.CLOUDFLARE_ADAPTER === "true";

// https://astro.build/config
export default defineConfig({
  output: "server",
  // adapter: alchemy(),
  adapter: isCloudflareAdapter
    ? cloudflare()
    : node({
        mode: "standalone",
      }),
  fonts: [
    {
      provider: fontProviders.google(),
      name: "Inter",
      cssVariable: "--font-inter",
    },
  ],

  vite: {
    plugins: [
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
      tailwindcss(),
      tanstackRouter({
        target: "react",
        routesDirectory: "./src/dashboard/routes",
        generatedRouteTree: "./src/dashboard/routeTree.gen.ts",
        routeFileIgnorePrefix: "-",
        quoteStyle: "double",
        autoCodeSplitting: true,
      }),
    ],
    ssr: {
      noExternal: [/^@feeblo\//],
    },
    build: {
      chunkSizeWarningLimit: 750,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules")) {
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

              if (id.includes("/node_modules/effect/dist/")) {
                return "effect-runtime-vendor";
              }

              if (id.includes("/@tanstack/")) {
                const match = /\/@tanstack\/([^/]+)/.exec(id);
                if (match) {
                  const name = match[1];
                  // react-store and react-router have a circular dependency,
                  // so keep them in the same chunk to avoid circular chunk warnings.
                  if (name === "react-store") {
                    return "tanstack-react-router-vendor";
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

              if (id.includes("/lucide-react/")) {
                return "lucide-vendor";
              }

              if (id.includes("/@floating-ui/")) {
                return "floating-ui-vendor";
              }

              if (
                id.includes("/@tiptap/") ||
                id.includes("/prosemirror-")
              ) {
                return "editor-vendor";
              }
            }
          },
        },
      },
    },
  },

  env: {
    schema: {
      API_URL: envField.string({
        context: "server",
        access: "secret",
        optional: false,
      }),
      APP_URL: envField.string({
        context: "server",
        access: "secret",
        optional: false,
      }),
      APP_ROOT_DOMAIN: envField.string({
        context: "server",
        access: "secret",
        optional: false,
      }),
      APP_RELEASE: envField.string({
        context: "server",
        access: "secret",
        optional: true,
      }),
      TURNSTILE_SITE_KEY: envField.string({
        context: "server",
        access: "secret",
        optional: true,
      }),
    },
  },

  integrations: [
    react({
      include: [
        "**/dashboard/**",
        "**/feature-board/**",
        "**/@feeblo/feedback-widget/**",
      ],
    }),
  ],
});
