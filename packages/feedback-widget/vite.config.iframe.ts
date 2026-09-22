import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { iconsSpritesheet } from "vite-plugin-icons-spritesheet";
import solid from "vite-plugin-solid";

/**
 * The iframe build of the feedback widget.
 *
 * The dashboard app (TanStack Start, React) serves the widget's HTML shell
 * from a server-only route and loads this bundle as a static asset — that is
 * what keeps React out of the iframe (see
 * `docs/tanstack-start-migration-research.md`). It is a plain Vite + Solid
 * build rather than a second entry in the Start app because Start's client
 * environment allows exactly one entry.
 *
 * The output is written into `apps/web/public/widget`, so the Start build
 * copies it into `dist/client/widget` (and the Cloudflare assets binding
 * uploads it with the rest of the static files). Fixed asset names
 * (`widget.js` / `widget.css`) let the server route reference them without
 * reading a manifest; the files are content-hashed only in the sense that
 * every deploy rewrites them, and the HTML shell is served no-store.
 */
export default defineConfig({
  plugins: [
    iconsSpritesheet({
      withTypes: true,
      inputDir: "src/icons/source",
      outputDir: "src/icons",
      typesOutputFile: "src/icons/types.ts",
      fileName: "sprite.svg",
      cwd: import.meta.dirname,
    }),
    solid(),
    tailwindcss(),
  ],
  build: {
    outDir: resolve(import.meta.dirname, "../../apps/web/public/widget"),
    emptyOutDir: true,
    cssMinify: true,
    rolldownOptions: {
      input: {
        widget: resolve(import.meta.dirname, "src/iframe-entry.tsx"),
      },
      output: {
        entryFileNames: "widget.js",
        chunkFileNames: "widget-[hash].js",
        assetFileNames: (assetInfo) => {
          const names = assetInfo.names ?? [];
          if (
            assetInfo.name?.endsWith(".css") ||
            names.some((name) => name.endsWith(".css"))
          ) {
            return "widget.css";
          }
          return "assets/[name]-[hash][extname]";
        },
      },
    },
  },
  server: {
    port: 5174,
    // The iframe document is served by the Start dev server on a different
    // origin (`localhost:3001` or `*.localhost:3001`), so the dev bundle is
    // requested cross-origin. Vite's default `cors` already allows localhost
    // origins; this only widens it to the configured root domain hosts.
    cors: true,
  },
});
