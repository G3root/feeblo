import { defineConfig } from "rolldown";

export default defineConfig({
  input: "./src/index.ts",
  platform: "node",
  external: [
    "react",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
    "react-dom",
    "react-dom/server",
    "@react-email/components",
    "@react-email/render",
  ],
  output: {
    dir: "dist",
    format: "esm",
  },
});
