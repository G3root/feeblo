import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "feeblo",
      fileName: (format) =>
        format === "es" ? "feeblo-sdk.js" : "feeblo-sdk.umd.cjs",
      formats: ["es", "umd"],
    },
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
