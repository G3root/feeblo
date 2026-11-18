declare module "*.css";

/**
 * The icon picker's generated sprite is imported as a URL, not inlined: it is
 * ~470 KB, and a Vite asset is one cacheable request that is fetched when the
 * picker opens instead of riding in the route chunk.
 */
declare module "*.svg?url" {
  const url: string;
  export default url;
}
