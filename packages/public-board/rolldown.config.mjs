import babel from "@rollup/plugin-babel";
import { defineConfig } from "rolldown";

const extensions = [".js", ".ts", ".tsx"];

export default defineConfig({
  input: "src/index.ts",
  output: {
    file: "dist/index.js",
    format: "esm",
    sourcemap: true,
  },

  plugins: [
    babel({
      extensions,
      babelHelpers: "bundled",
      include: ["src/**/*"],
      presets: [
        [
          "babel-preset-solid",
          {
            generate: "dom",
            hydratable: true,
          },
        ],
        "@babel/preset-typescript",
      ],
    }),
  ],
});
