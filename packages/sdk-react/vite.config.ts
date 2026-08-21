import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "FeebloReact",
      fileName: () => "feeblo-sdk-react.js",
      formats: ["es"],
    },
    rollupOptions: {
      external: ["react", "react/jsx-runtime", "react-dom", "@feeblo/sdk"],
    },
    outDir: "dist",
    sourcemap: true,
    emptyOutDir: true,
  },
});
