// @ts-check

import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
// import alchemy from "alchemy/cloudflare/astro";
import { defineConfig, envField } from "astro/config";

// https://astro.build/config
export default defineConfig({
  output: "server",
  // adapter: alchemy(),

  vite: {
    plugins: [
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
  },

  env: {
    schema: {
      VITE_API_URL: envField.string({
        context: "client",
        access: "public",
        optional: false,
      }),
      VITE_APP_URL: envField.string({
        context: "client",
        access: "public",
        optional: false,
      }),
      VITE_APP_ROOT_DOMAIN: envField.string({
        context: "client",
        access: "public",
        optional: false,
      }),
    },
  },

  integrations: [react()],
});
