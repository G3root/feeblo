import { initPostUiI18n, isPostUiI18nInitialized } from "@feeblo/post-ui/i18n";
import {
  initPublicBoardI18n,
  isPublicBoardI18nInitialized,
  PublicBoardApp,
  type PublicBoardAppProps,
} from "@feeblo/public-feature-board";

import { getLocale, setLocale } from "@/paraglide/runtime.js";

/**
 * Host entrypoint for the public board island.
 *
 * The board and the shared post UI compile their own messages with the
 * `baseLocale` fallback strategy, so the host must inject its locale runtime
 * into each. `client:only` keeps this module out of the server render, and
 * the app's cookie-based strategy stays the single source of truth.
 *
 * `<html lang dir>` is resolved before first paint by the inline
 * `LocaleScript` in `PublicBoardLayout.astro`, which reads the same cookie
 * without waiting for hydration. The SSR document itself stays
 * locale-agnostic because it is CDN-cached (`s-maxage=60`) and therefore
 * cannot carry a per-locale variant.
 */
export function PublicBoardIsland(props: PublicBoardAppProps) {
  if (!isPostUiI18nInitialized()) {
    initPostUiI18n({ getLocale, setLocale });
  }

  if (!isPublicBoardI18nInitialized()) {
    initPublicBoardI18n({ getLocale, setLocale });
  }

  return <PublicBoardApp {...props} />;
}
