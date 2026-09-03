// Consolidated into ./hooks/use-media-query.ts, which implements the same
// breakpoint via `useSyncExternalStore` (no first-paint flicker, single
// shared listener). This module remains as a compatibility re-export.
export { useIsMobile, useMediaQuery } from "./hooks/use-media-query";
