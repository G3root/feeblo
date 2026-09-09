import {
  overwriteGetLocale,
  overwriteSetLocale,
  type Locale,
  type SetLocaleFn,
} from "./paraglide/runtime.js";

/**
 * Host-provided locale runtime.
 *
 * The public board owns its own message catalog (compiled with the
 * `baseLocale` fallback strategy) but must never detect the locale from the
 * URL, cookies, or storage itself. The Astro host injects its own runtime so
 * every surface shares one strategy and locale changes propagate.
 */
export interface PublicBoardI18nRuntime {
  getLocale: () => Locale;
  setLocale: SetLocaleFn;
}

let initialized = false;

/**
 * Overrides the board's Paraglide runtime with the host app's locale
 * resolution. Call once from the host entrypoint before rendering the board.
 * Idempotent: repeated calls just re-apply the host runtime.
 */
export function initPublicBoardI18n(runtime: PublicBoardI18nRuntime) {
  overwriteGetLocale(runtime.getLocale);
  overwriteSetLocale(runtime.setLocale);
  initialized = true;
}

export function isPublicBoardI18nInitialized() {
  return initialized;
}
