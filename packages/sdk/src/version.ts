declare const __FEEBLO_VERSION__: string | undefined;

/**
 * The installed SDK version. Automatically populated from `package.json` at
 * build time and safe to use in non-bundled (type-check) contexts.
 */
export const VERSION: string =
  typeof __FEEBLO_VERSION__ === "string" ? __FEEBLO_VERSION__ : "0.0.1";
