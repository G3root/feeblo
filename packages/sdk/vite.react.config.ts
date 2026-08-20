import { defineConfig } from "vite";

import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  define: {
    __FEEBLO_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    lib: {
      entry: "src/react/index.ts",
      name: "FeebloReact",
      fileName: (format) => (format === "es" ? "index.js" : "index.umd.cjs"),
      formats: ["es", "umd"],
    },
    outDir: "dist/react",
    sourcemap: true,
    emptyOutDir: false,
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime"],
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
          "react/jsx-runtime": "jsxRuntime",
        },
      },
    },
  },
});
