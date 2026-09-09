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
