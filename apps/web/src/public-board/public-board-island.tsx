import { initPostUiI18n, isPostUiI18nInitialized } from "@feeblo/post-ui/i18n";
import {
  initPublicBoardI18n,
  isPublicBoardI18nInitialized,
  PublicBoardApp,
  type PublicBoardAppProps,
} from "@feeblo/public-feature-board";
import { hasWindow } from "@feeblo/utils/runtime-kind";

import { getLocale, setLocale } from "@/paraglide/runtime.js";

/**
 * Host entrypoint for the public board app.
 *
 * The board and the shared post UI compile their own messages with the
 * `baseLocale` fallback strategy, so the host must inject its locale runtime
 * into each. The app's cookie-based strategy stays the single source of truth.
 *
 * `<html lang dir>` is resolved before first paint by the root shell's inline
 * locale script, which reads the same cookie without waiting for hydration.
 * The SSR document itself stays locale-agnostic because it is CDN-cached
 * (`s-maxage=60`) and therefore cannot carry a per-locale variant.
 */
export function PublicBoardIsland(props: PublicBoardAppProps) {
  // The board's collections and mutations read the tenant from the injected
  // runtime env (`window.global.__ENV.organizationId`); the Astro layout used
  // to inject it alongside the site. The root env script cannot know which
  // tenant the host is, so the board installs it here — inside `ClientOnly`,
  // before the inner router's `beforeLoad` reads it.
  installOrganizationId(props.site.organizationId);

  if (!isPostUiI18nInitialized()) {
    initPostUiI18n({ getLocale, setLocale });
  }

  if (!isPublicBoardI18nInitialized()) {
    initPublicBoardI18n({ getLocale, setLocale });
  }

  return <PublicBoardApp {...props} />;
}

function installOrganizationId(organizationId: string) {
  if (!hasWindow()) {
    return;
  }

  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  const runtimeWindow = window as Window & {
    global?: { __ENV?: { organizationId?: string } };
  };
  runtimeWindow.global = runtimeWindow.global ?? {};
  runtimeWindow.global.__ENV = {
    ...runtimeWindow.global.__ENV,
    organizationId,
  };
}
