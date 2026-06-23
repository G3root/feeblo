import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { iconsSpritesheet } from "vite-plugin-icons-spritesheet";
import solid from "vite-plugin-solid";

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
    lib: {
      entry: resolve(import.meta.dirname, "src/main.tsx"),
      name: "FeebloFeedbackWidget",
      fileName: "feeblo-feedback-widget",
      formats: ["es"],
    },
    rolldownOptions: {
      external: [
        "solid-js",
        "solid-js/web",
        "solid-js/store",
        "@solidjs/router",
      ],
      output: {
        assetFileNames: "feeblo-feedback-widget[extname]",
      },
    },
    outDir: "dist",
    emptyOutDir: true,
    cssMinify: true,
  },
  server: {
    port: 5174,
  },
});
