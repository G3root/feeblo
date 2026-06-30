// @ts-check

import { fileURLToPath } from "node:url";
import cloudflare from "@astrojs/cloudflare";
import node from "@astrojs/node";
import react from "@astrojs/react";
import solidJs from "@astrojs/solid-js";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
// import alchemy from "alchemy/cloudflare/astro";
import { defineConfig, envField, fontProviders } from "astro/config";
import { iconsSpritesheet } from "vite-plugin-icons-spritesheet";

const isCloudflareAdapter = process.env.CLOUDFLARE_ADAPTER === "true";

const widgetDir = fileURLToPath(
  new URL("../../packages/feedback-widget", import.meta.url)
);
const widgetIconsSource = fileURLToPath(
  new URL("../../packages/feedback-widget/src/icons/source", import.meta.url)
);
const widgetIconsDir = fileURLToPath(
  new URL("../../packages/feedback-widget/src/icons", import.meta.url)
);

const reactRoutes = [
  "**/dashboard/**",
  "**/public-feature-board/**",
  "**/@feeblo/public-feature-board/**",
];
const solidRoutes = [
  "**/packages/feedback-widget/**",
  "**/@feeblo/feedback-widget/**",
  "**/node_modules/@solidjs/router/**",
];
const tanstackPackageRegex = /\/@tanstack\/([^/]+)/;

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
      iconsSpritesheet({
        inputDir: widgetIconsSource,
        outputDir: widgetIconsDir,
        fileName: "sprite.svg",
        cwd: widgetDir,
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
      rolldownOptions: {
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

              if (id.includes("/@tiptap/") || id.includes("/prosemirror-")) {
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
      include: reactRoutes,
      exclude: solidRoutes,
    }),
    solidJs({
      exclude: reactRoutes,
      include: solidRoutes,
    }),
  ],
});
