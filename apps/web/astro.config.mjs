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
              // if (id.includes("/@hugeicons")) {
              //   return "hugeicons-vendor";
              // }

              // biome-ignore lint/style/useCollapsedIf: <explanation>
              if (id.includes("/effect/")) {
                return "effect-runtime-vendor";
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
      include: ["**/dashboard/**", "**/feature-board/**"],
    }),
  ],
});
