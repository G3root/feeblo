import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/main.tsx"),
      name: "FeebloFeedbackWidget",
      fileName: "feeblo-feedback-widget",
      formats: ["es"],
    },
    rollupOptions: {
      external: ["react", "react-dom", "@tanstack/react-router"],
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
