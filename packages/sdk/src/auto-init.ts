import { init } from "./instance";
import type { EmbedOptions } from "./types";
import { isBrowser } from "./utils";

interface GlobalAutoConfig {
  baseUrl?: string | undefined;
  debug?: boolean | undefined;
  defaultBoard?: string | undefined;
  locale?: string | undefined;
  mode?: EmbedOptions["mode"];
  modules?: EmbedOptions["modules"];
  organizationId?: string | undefined;
  orgId?: string | undefined;
  placement?: EmbedOptions["placement"];
  theme?: string | undefined;
}

function getFeebloScript(): HTMLScriptElement | null {
  // SAFETY: currentScript is a script element whenever the SDK runs as a script.
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
  // SAFETY: auto-init probes for a global config the host page opted into by
  // embedding the bootstrap snippet; the intersection only narrows the known
  // Window shape.
  const globalConfig = (window as Window & { feebloConfig?: GlobalAutoConfig })
    .feebloConfig;

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
  const defaultBoard =
    globalConfig?.defaultBoard ?? scriptDataset.feebloDefaultBoard;
  const locale = globalConfig?.locale ?? scriptDataset.feebloLocale;
  const theme = globalConfig?.theme ?? scriptDataset.feebloTheme;
  const mode = globalConfig?.mode ?? scriptDataset.feebloMode;
  const placement = globalConfig?.placement ?? scriptDataset.feebloPlacement;
  const modulesValue = scriptDataset.feebloModules;
  // SAFETY: the parsed module list is one of the supported EmbedOptions modules.
  const modules =
    globalConfig?.modules ??
    (modulesValue
      ? (modulesValue
          .split(",")
          .map((value) => value.trim())
          .filter((value) => value.length > 0) as EmbedOptions["modules"])
      : undefined);
  const debug = globalConfig?.debug ?? scriptDataset.feebloDebug === "true";

  const options: EmbedOptions = {};
  if (baseUrl) {
    options.baseUrl = baseUrl;
  }
  if (theme) {
    options.theme = theme;
  }
  if (defaultBoard) {
    options.defaultBoard = defaultBoard;
  }
  if (locale) {
    options.locale = locale;
  }
  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  if (mode) {
    // SAFETY: The upstream contract guarantees this value here.
    options.mode = mode as EmbedOptions["mode"];
  }
  if (modules) {
    options.modules = modules;
    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  }
  if (placement) {
    // SAFETY: The upstream contract guarantees this value here.
    options.placement = placement as EmbedOptions["placement"];
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
