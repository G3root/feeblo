import { normalizeWidgetConfig, widgetConfigKey } from "./config";
import { banner } from "./debug";
import {
  getDefaultEmbedDependencies,
  Embed,
  type EmbedDependencies,
} from "./embed";
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

/** Boxed-prototype classification for untrusted runtime values (no `typeof`). */
const boxedKind = <T>(value: T): string | null => {
  if (value === null || value === undefined) return null;
  // SAFETY: Object.getPrototypeOf always returns an object or null; every
  // prototype carries a constructor whose name identifies the built-in.
  const prototype = Object.getPrototypeOf(Object(value)) as {
    constructor?: { name?: string };
  } | null;
  return prototype?.constructor?.name ?? null;
};

const isStringValue = <T>(value: T): value is T & string =>
  boxedKind(value) === "String";

const isObjectValue = <T>(value: T): boolean => {
  const kind = boxedKind(value);
  return (
    kind !== null &&
    kind !== "String" &&
    kind !== "Number" &&
    kind !== "Boolean" &&
    kind !== "Symbol" &&
    kind !== "BigInt" &&
    kind !== "Function"
  );
};

let currentEmbed: Embed | null = null;
let currentOrgId: string | null = null;
let embedDependencies: EmbedDependencies | undefined;

export function setEmbedDependencies(
  overrides: Partial<EmbedDependencies>
): () => void {
  const previous = embedDependencies;
  embedDependencies = {
    ...(embedDependencies ?? getDefaultEmbedDependencies()),
    ...overrides,
  };
  return () => {
    embedDependencies = previous;
  };
}
let globalCleanup: (() => void) | null = null;
let linkCleanup: (() => void) | null = null;

function setupGlobalListeners(): void {
  if (globalCleanup) {
    return;
  }

  const handleExternalMessage = (e: MessageEvent<unknown>) => {
    // SAFETY: the message contract is established by the guards below (object
    // value, FeebloWidget target, non-empty data) before any field is read.
    const msg = e.data as ExternalMessageData;
    if (
      !msg ||
      !isObjectValue(msg) ||
      msg.target !== "FeebloWidget" ||
      !msg.data
    ) {
      return;
    }
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
 *
 * Guards against destroying a stale embed that has already been replaced by
 * a newer singleton with the same container ID — calling destroy on a
 * non-current embed would remove the current singleton's DOM.
 */
export function destroyInstance(embed: Embed | null): void {
  if (!embed) {
    return;
  }
  if (currentEmbed === embed) {
    embed.destroy();
    stopTriggerScanning();
    linkCleanup?.();
    linkCleanup = null;
    globalCleanup?.();
    currentEmbed = null;
    currentOrgId = null;
  }
}

export function getCurrentWidget(): FeebloWidget | null {
  if (!currentEmbed) return null;
  return createWidgetProxy(currentEmbed);
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
      return createWidgetProxy(currentEmbed);
    }
    if (currentEmbed.getAutoLoginToken()) {
      // P1 security: clearing must not rely on empty IDENTIFY alone (validator
      // previously discarded it). Destroy and recreate anonymously to guarantee
      // the iframe does not retain the logged-out token.
      destroyInstance(currentEmbed);
    } else {
      return createWidgetProxy(currentEmbed);
    }
  }

  if (currentEmbed) {
    destroyInstance(currentEmbed);
  }

  const embed = new Embed(
    organizationId,
    resolvedOptions,
    normalizedConfig,
    embedDependencies ?? getDefaultEmbedDependencies()
  );
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
