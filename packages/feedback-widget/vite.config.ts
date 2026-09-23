import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { iconsSpritesheet } from "vite-plugin-icons-spritesheet";
import solid from "vite-plugin-solid";

/**
 * The widget's dev server.
 *
 * The iframe document is served by the Start dev server on a different origin
 * (`localhost:3001` or `*.localhost:3001`), so this server has to serve the
 * dev bundle cross-origin. Vite's default `cors` already allows localhost
 * origins; this only widens it to the configured root-domain hosts.
 *
 * The production iframe is a separate build (`vite.config.iframe.ts`); this
 * config is what `pnpm dev` loads, so it must keep the Solid, Tailwind, and
 * icon-spritesheet plugins the dev entry relies on.
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
  server: {
    port: 5174,
    cors: true,
  },
});
