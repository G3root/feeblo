import { init } from "./instance";
import type { EmbedOptions } from "./types";
import { isBrowser } from "./utils";

interface GlobalAutoConfig {
  baseUrl?: string | undefined;
  debug?: boolean | undefined;
  organizationId?: string | undefined;
  orgId?: string | undefined;
  theme?: string | undefined;
}

function getFeebloScript(): HTMLScriptElement | null {
  const currentScript = document.currentScript as HTMLScriptElement | null;
  if (currentScript && hasFeebloSource(currentScript.src)) {
    return currentScript;
  }

  for (const script of document.getElementsByTagName("script")) {
    if (hasFeebloSource(script.src)) {
      return script;
    }
  }

  return null;
}

function hasFeebloSource(src: string): boolean {
  return src.includes("feeblo-sdk") || src.includes("feeblo");
}

function getAutoConfig(): { orgId: string; options: EmbedOptions } | null {
  const globalConfig = (window as unknown as Record<string, unknown>)
    .feebloConfig as GlobalAutoConfig | undefined;

  const script = getFeebloScript();
  const scriptDataset = script?.dataset ?? {};

  const orgId =
    globalConfig?.orgId ??
    globalConfig?.organizationId ??
    scriptDataset.feebloOrg ??
    scriptDataset.feebloOrganizationId;

  if (!orgId) {
    return null;
  }

  const baseUrl = globalConfig?.baseUrl ?? scriptDataset.feebloBaseUrl;
  const theme = globalConfig?.theme ?? scriptDataset.feebloTheme;
  const debug = globalConfig?.debug ?? scriptDataset.feebloDebug === "true";

  const options: EmbedOptions = {};
  if (baseUrl) {
    options.baseUrl = baseUrl;
  }
  if (theme) {
    options.theme = theme;
  }
  if (debug) {
    options.debug = true;
  }

  return { orgId, options };
}

/**
 * Auto-initialise the widget from `window.feebloConfig` or the SDK script tag's
 * `data-feeblo-*` attributes. Runs once on load.
 */
export function autoInit(): void {
  if (!isBrowser()) {
    return;
  }
  const autoConfig = getAutoConfig();
  if (autoConfig) {
    init(autoConfig.orgId, autoConfig.options);
  }
}

autoInit();
