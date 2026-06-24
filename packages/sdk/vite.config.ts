import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  define: {
    __FEEBLO_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    lib: {
      entry: "src/index.ts",
      name: "Feeblo",
      fileName: (format) =>
        format === "es" ? "feeblo-sdk.js" : "feeblo-sdk.umd.cjs",
      formats: ["es", "umd"],
    },
    outDir: "dist",
    sourcemap: true,
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
