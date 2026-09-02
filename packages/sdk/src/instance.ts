/* eslint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-conditional-empty-object-spread -- SDK boundary uses plain JS validation (no Effect dependency) */
import { normalizeWidgetConfig, widgetConfigKey } from "./config";
import { banner } from "./debug";
import { Embed } from "./embed";
import { EmbedError } from "./errors";
import { resolveBaseUrl } from "./iframe";
import { startLinkAuthentication } from "./links";
import { startTriggerScanning, stopTriggerScanning } from "./triggers";
import type {
  EmbedOptions,
  ExternalMessageData,
  FeebloWidget,
  InitConfig,
  OrganizationId,
} from "./types";
import { isBrowser } from "./utils";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringValue(value: unknown): value is string {
  return typeof value === "string";
}

function parseExternalMessageData(value: unknown): ExternalMessageData | null {
  if (!isRecord(value)) return null;
  const target = value.target;
  const data = value.data;
  if (!isStringValue(target) || target !== "FeebloWidget") return null;
  if (!isRecord(data)) return null;
  const action = data.action;
  if (!isStringValue(action) || action.length === 0) return null;
  const setBoard = data.setBoard;
  if (setBoard !== undefined && !isStringValue(setBoard)) return null;
  const parsedData: ExternalMessageData["data"] = { action };
  if (isStringValue(setBoard) && setBoard.length > 0) {
    parsedData.setBoard = setBoard;
  }
  return {
    target,
    data: parsedData,
  };
}

let currentEmbed: Embed | null = null;
let currentOrgId: string | null = null;
let globalCleanup: (() => void) | null = null;
let linkCleanup: (() => void) | null = null;

function setupGlobalListeners(): void {
  if (globalCleanup) {
    return;
  }

  const handleExternalMessage = (e: MessageEvent<unknown>) => {
    const msg = parseExternalMessageData(e.data);
    if (msg === null) return;
    if (msg.data.action === "openFeedbackWidget" && currentEmbed) {
      if (msg.data.setBoard) {
        currentEmbed.setBoard(msg.data.setBoard);
      }
      currentEmbed.openModule("feedback");
      if (!currentEmbed.isOpenState()) {
        currentEmbed.open();
      }
    }
  };

  window.addEventListener("message", handleExternalMessage);

  globalCleanup = () => {
    window.removeEventListener("message", handleExternalMessage);
    globalCleanup = null;
  };
}

/**
 * Tear down an embed and, when it is the active singleton, release the shared
 * trigger scanner and global message listener.
 */
export function destroyInstance(embed: Embed | null): void {
  if (!embed) {
    return;
  }
  embed.destroy();
  if (currentEmbed === embed) {
    stopTriggerScanning();
    linkCleanup?.();
    linkCleanup = null;
    globalCleanup?.();
    currentEmbed = null;
    currentOrgId = null;
  }
}

function createWidgetProxy(embed: Embed): FeebloWidget {
  const widget: FeebloWidget = {
    identify: (identity) => {
      embed.identify(identity);
      return widget;
    },
    setBoard: (board) => {
      embed.setBoard(board);
      return widget;
    },
    metadata: (patch) => {
      embed.metadata(patch);
      return widget;
    },
    isOpen: () => embed.isOpenState(),
    open: (trigger, metadata) => {
      embed.open(trigger, metadata);
      return widget;
    },
    openModule: (module) => {
      embed.openModule(module);
      return widget;
    },
    close: () => {
      embed.close();
      return widget;
    },
    destroy: () => {
      destroyInstance(embed);
    },
  };
  return widget;
}

function noopWidget(): FeebloWidget {
  const self: FeebloWidget = {
    identify: () => self,
    setBoard: () => self,
    metadata: () => self,
    open: () => self,
    openModule: () => self,
    close: () => self,
    destroy: () => undefined,
    isOpen: () => false,
  };
  return self;
}

/**
 * Initialise the Feeblo feedback widget for an organization.
 *
 * @example
 * feeblo.init("org_123", { user: { id: "u_1" } });
 * @example
 * feeblo.init({ organizationId: "org_123", theme: "dark", debug: true });
 */
export function init(
  organizationId: string | OrganizationId,
  options?: EmbedOptions
): FeebloWidget;
export function init(config: InitConfig): FeebloWidget;
export function init(
  orgIdOrConfig: (string | OrganizationId) | InitConfig,
  options: EmbedOptions = {}
): FeebloWidget {
  let organizationId: string;
  let resolvedOptions: EmbedOptions = options;

  if (isStringValue(orgIdOrConfig)) {
    organizationId = orgIdOrConfig;
  } else {
    const { organizationId: id, ...rest } = orgIdOrConfig;
    // SAFETY: the union branch above established that orgIdOrConfig is the
    // InitConfig shape, whose organizationId is a string.
    organizationId = id as string;
    resolvedOptions = rest;
  }

  if (!isStringValue(organizationId) || organizationId.length === 0) {
    throw new EmbedError({
      code: "INVALID_ORG",
      message:
        "[feeblo-sdk] `organizationId` is required. Pass the id shown under Settings → Widget → Installation.",
    });
  }

  if (!isBrowser()) {
    return noopWidget();
  }

  const normalizedConfig = normalizeWidgetConfig(resolvedOptions);
  const nextConfigKey = widgetConfigKey(normalizedConfig);
  if (
    currentEmbed &&
    currentOrgId === organizationId &&
    currentEmbed.getConfigKey() === nextConfigKey
  ) {
    if (resolvedOptions.user) {
      currentEmbed.identify(resolvedOptions.user);
    }
    return createWidgetProxy(currentEmbed);
  }

  if (currentEmbed) {
    destroyInstance(currentEmbed);
  }

  const embed = new Embed(organizationId, resolvedOptions, normalizedConfig);
  currentEmbed = embed;
  currentOrgId = organizationId;

  setupGlobalListeners();
  startTriggerScanning(embed, embed.logger);
  linkCleanup = startLinkAuthentication(embed, embed.logger);

  if (embed.logger.enabled) {
    banner(organizationId, resolveBaseUrl(resolvedOptions));
  }

  return createWidgetProxy(embed);
}

export function getCurrentEmbed(): Embed | null {
  return currentEmbed;
}
