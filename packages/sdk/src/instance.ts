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

let currentEmbed: Embed | null = null;
let currentOrgId: string | null = null;
let globalCleanup: (() => void) | null = null;
let linkCleanup: (() => void) | null = null;

function setupGlobalListeners(): void {
  if (globalCleanup) {
    return;
  }

  const handleExternalMessage = (e: MessageEvent<unknown>) => {
    const msg = e.data as ExternalMessageData;
    if (
      !msg ||
      typeof msg !== "object" ||
      msg.target !== "FeebloWidget" ||
      !msg.data
    ) {
      return;
    }
    if (msg.data.action === "openFeedbackWidget" && currentEmbed) {
      if (msg.data.setBoard) {
        currentEmbed.setBoard(msg.data.setBoard);
      }
      currentEmbed.open();
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
    identify: (user) => {
      embed.identify(user);
      return widget;
    },
    setBoard: (board) => {
      embed.setBoard(board);
      return widget;
    },
    open: (trigger, metadata) => {
      embed.open(trigger, metadata);
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
    open: () => self,
    close: () => self,
    destroy: () => undefined,
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

  if (typeof orgIdOrConfig === "string") {
    organizationId = orgIdOrConfig;
  } else {
    const { organizationId: id, ...rest } = orgIdOrConfig;
    organizationId = id as string;
    resolvedOptions = rest;
  }

  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new EmbedError({
      code: "INVALID_ORG",
      message:
        "[feeblo-sdk] `organizationId` is required. Pass the id shown under Settings → Widget → Installation.",
    });
  }

  if (!isBrowser()) {
    return noopWidget();
  }

  if (currentEmbed && currentOrgId === organizationId) {
    if (resolvedOptions.user) {
      currentEmbed.identify(resolvedOptions.user);
    }
    return createWidgetProxy(currentEmbed);
  }

  if (currentEmbed) {
    destroyInstance(currentEmbed);
  }

  const embed = new Embed(organizationId, resolvedOptions);
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
