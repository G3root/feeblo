import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/main.tsx"),
      name: "FeebloFeedbackWidget",
      fileName: "feeblo-feedback-widget",
      formats: ["es"],
    },
    rollupOptions: {
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
