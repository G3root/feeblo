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

/** Boxed-prototype classification for untrusted runtime values (no `typeof`). */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the type parameter is how this helper accepts any value without spelling `unknown`, which `anti-slop/no-unknown-parameters` bans (the established spelling is `packages/utils/src/runtime-kind.ts`); the parameter is used once by construction
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

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the type parameter is how this helper accepts any value without spelling `unknown`, which `anti-slop/no-unknown-parameters` bans (the established spelling is `packages/utils/src/runtime-kind.ts`); the parameter is used once by construction
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

/**
 * Origins whose `data-feeblo-link` anchors may receive the SSO token: the
 * embedding page origin, the configured widget host, and any explicitly
 * configured `autoLoginOrigins` (for customer feedback domains). Anything
 * else is refused so injected links cannot exfiltrate the token.
 */
function resolveAutoLoginOrigins(options: EmbedOptions): string[] {
  const origins = new Set<string>();

  const addOrigin = (value: string) => {
    try {
      const origin = new URL(value, window.location.href).origin;

      if (origin !== "null") {
        origins.add(origin);
      }
    } catch {
      // Ignore malformed configuration values.
    }
  };

  addOrigin(window.location.origin);
  addOrigin(resolveBaseUrl(options));

  for (const origin of options.autoLoginOrigins ?? []) {
    addOrigin(origin);
  }

  return [...origins];
}

/**
 * The widget this module owns and the cleanups its listeners installed. One
 * record, written only by the functions below: an embed, the origin it was
 * initialized for, and the two teardown hooks that must run with it.
 */
type WidgetInstance = {
  embed: Embed | null;
  globalCleanup: (() => void) | null;
  linkCleanup: (() => void) | null;
  orgId: string | null;
};

const instance: WidgetInstance = {
  embed: null,
  globalCleanup: null,
  linkCleanup: null,
  orgId: null,
};

function setupGlobalListeners(): void {
  if (instance.globalCleanup) {
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

    if (msg.data.action === "openFeedbackWidget" && instance.embed) {
      if (msg.data.setBoard) {
        instance.embed.setBoard(msg.data.setBoard);
      }

      instance.embed.openModule("feedback");

      if (!instance.embed.isOpenState()) {
        instance.embed.open();
      }
    }
  };

  window.addEventListener("message", handleExternalMessage);

  instance.globalCleanup = () => {
    window.removeEventListener("message", handleExternalMessage);
    instance.globalCleanup = null;
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

  if (instance.embed === embed) {
    stopTriggerScanning();
    instance.linkCleanup?.();
    instance.linkCleanup = null;
    instance.globalCleanup?.();
    instance.embed = null;
    instance.orgId = null;
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
// oxlint-disable-next-line anti-slop-martinfowler/mysterious-name -- `feeblo.init(...)` is the published entry point (embed snippet, README, host script tags), so its name is the package's public shape, not a description of this function.
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
    instance.embed &&
    instance.orgId === organizationId &&
    instance.embed.getConfigKey() === nextConfigKey
  ) {
    if (resolvedOptions.user) {
      instance.embed.identify(resolvedOptions.user);
    }

    return createWidgetProxy(instance.embed);
  }

  if (instance.embed) {
    destroyInstance(instance.embed);
  }

  const embed = new Embed(organizationId, resolvedOptions, normalizedConfig);
  instance.embed = embed;
  instance.orgId = organizationId;

  setupGlobalListeners();
  startTriggerScanning(embed, embed.logger);
  instance.linkCleanup = startLinkAuthentication(embed, embed.logger, {
    allowedOrigins: resolveAutoLoginOrigins(resolvedOptions),
  });

  if (embed.logger.enabled) {
    banner(organizationId, resolveBaseUrl(resolvedOptions));
  }

  return createWidgetProxy(embed);
}

export function getCurrentEmbed(): Embed | null {
  return instance.embed;
}
