import { defineConfig } from "rolldown";

export default defineConfig({
  input: {
    index: "./src/index.ts",
    "configure-embeddings": "./src/configure-embeddings.ts",
  },
  platform: "node",
  output: {
    dir: "dist",
    format: "esm",
  },
});
