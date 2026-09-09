import {
  overwriteGetLocale,
  overwriteSetLocale,
  type Locale,
  type SetLocaleFn,
} from "./paraglide/runtime.js";

/**
 * Host-provided locale runtime.
 *
 * `@feeblo/post-ui` owns its own message catalog (compiled with the
 * `baseLocale` fallback strategy) but must never detect the locale from the
 * URL, cookies, or storage itself. Each host app injects its own runtime so
 * the dashboard and the public board share one strategy.
 */
export interface PostUiI18nRuntime {
  getLocale: () => Locale;
  setLocale: SetLocaleFn;
}

let initialized = false;

/**
 * Overrides the package's Paraglide runtime with the host app's locale
 * resolution. Call once from each host entrypoint before rendering.
 * Idempotent: repeated calls just re-apply the host runtime.
 */
export function initPostUiI18n(runtime: PostUiI18nRuntime) {
  overwriteGetLocale(runtime.getLocale);
  overwriteSetLocale(runtime.setLocale);
  initialized = true;
}

export function isPostUiI18nInitialized() {
  return initialized;
}
