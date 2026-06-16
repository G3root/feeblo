import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "feeblo",
      fileName: (format) =>
        format === "es" ? "feeblo-embed.js" : "feeblo-embed.umd.cjs",
      formats: ["es", "umd"],
    },
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
