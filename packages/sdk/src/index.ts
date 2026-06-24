import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
} from "@floating-ui/dom";

const CONTAINER_ID = "feeblo-embed-container";
const FEEDBACK_ATTRIBUTE = "data-feeblo-feedback";
const SCAN_INTERVAL_MS = 1000;
const FADE_DURATION_MS = 150;

const CONTAINER_STYLES: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  width: "400px",
  height: "400px",
  maxHeight: "600px",
  margin: "0",
  top: "0",
  left: "0",
  opacity: "0",
  transition: `opacity ${FADE_DURATION_MS}ms ease-out`,
  zIndex: "999999",
  display: "none",
  borderRadius: "16px",
  overflow: "hidden",
  boxShadow:
    "0 0 0 1px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.06), 0 12px 24px rgba(0, 0, 0, 0.08), 0 24px 48px rgba(0, 0, 0, 0.12)",
  border: "none",
};

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function compact<T extends object>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbedErrorDetails {
  code: string;
  message: string;
}

export class EmbedError extends Error {
  code: string;

  constructor({ code, message }: EmbedErrorDetails) {
    super(message);
    this.code = code;
    this.name = "EmbedError";
  }
}

export interface WidgetCompany {
  id: string;
  monthlySpend?: number | undefined;
  name: string;
}

export interface UserIdentity {
  avatar?: string | undefined;
  companies?: WidgetCompany[] | undefined;
  email?: string | undefined;
  firstName?: string | undefined;
  id: string;
  lastName?: string | undefined;
  token?: string | undefined;
}

interface NormalizedUserIdentity {
  avatar?: string | undefined;
  companies?: WidgetCompany[] | undefined;
  email?: string | undefined;
  firstName?: string | undefined;
  id: string;
  lastName?: string | undefined;
  token?: string | undefined;
}

const COMPANY_KEYS = ["id", "name", "monthlySpend"] as const;

function normalizeCompany(
  company: WidgetCompany
): Pick<WidgetCompany, "id" | "name" | "monthlySpend"> {
  const result: Record<string, unknown> = {};
  for (const key of COMPANY_KEYS) {
    if (company[key] !== undefined) {
      result[key] = company[key];
    }
  }
  return result as Pick<WidgetCompany, "id" | "name" | "monthlySpend">;
}

function normalizeUserIdentity(user: UserIdentity): NormalizedUserIdentity {
  const { id, ...rest } = user;
  if (!id) {
    throw new EmbedError({
      code: "INVALID_IDENTITY",
      message: "[feeblo-sdk] `id` is required to identify a widget user.",
    });
  }

  const base: Record<string, unknown> = {};
  for (const key of [
    "email",
    "firstName",
    "lastName",
    "avatar",
    "token",
  ] as const) {
    if (rest[key] !== undefined) {
      base[key] = rest[key];
    }
  }

  const companies = rest.companies?.map(normalizeCompany);
  return {
    id,
    ...base,
    ...(companies ? { companies } : {}),
  } as NormalizedUserIdentity;
}

export interface EmbedOptions {
  baseUrl?: string | undefined;
  containerStyles?: Partial<CSSStyleDeclaration> | undefined;
  onClose?: (() => void) | undefined;
  onError?: ((error: EmbedError) => void) | undefined;
  onHeightChange?: ((height: number) => void) | undefined;
  root?: HTMLElement | undefined;
  theme?: string | undefined;
  user?: UserIdentity | undefined;
}

export interface FeebloWidget {
  close: () => void;
  destroy: () => void;
  identify: (user: UserIdentity) => void;
  open: () => void;
  setBoard: (board: string) => void;
}

type IncomingMessage =
  | { event: "ERROR"; data?: { code?: string; message?: string } }
  | { event: "PAGE_HEIGHT"; data?: { height?: number } }
  | { event: "CLOSE" }
  | { event: "READY" }
  | { event: "WIDGET_OPENED"; data?: unknown }
  | { event: "FEEDBACK_SUBMITTED"; data?: { post?: unknown } };

type ExternalMessageData = {
  target: string;
  data: { action: string; setBoard?: string };
};

type CleanupContainer = HTMLDivElement & { _feebloCleanup?: () => void };

export type FeebloEventName =
  | "widgetReady"
  | "widgetOpened"
  | "feedbackSubmitted";

export interface FeebloEventDetail {
  data: unknown;
  namespace: string;
  type: string;
}

type EventCallback = (e: CustomEvent<FeebloEventDetail>) => void;

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

function emitWidgetEvent(type: string, data?: unknown): void {
  window.dispatchEvent(
    new CustomEvent<FeebloEventDetail>(type, {
      detail: { data, type, namespace: "feeblo" },
    })
  );
}

// ---------------------------------------------------------------------------
// Floating UI positioning
// ---------------------------------------------------------------------------

function createFloatingInstance(
  reference: HTMLElement,
  floating: HTMLElement
): () => void {
  return autoUpdate(reference, floating, () => {
    computePosition(reference, floating, {
      placement: "bottom",
      middleware: [offset(10), flip({ padding: 8 }), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      Object.assign(floating.style, {
        left: `${x}px`,
        top: `${y}px`,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Trigger scanner
// ---------------------------------------------------------------------------

function findTriggers(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(`[${FEEDBACK_ATTRIBUTE}]`)
  );
}

const METADATA_KEY_REGEX = /^feeblo([A-Z]\w*)$/;

function extractTriggerMetadata(element: HTMLElement): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const key of Object.keys(element.dataset)) {
    const match = key.match(METADATA_KEY_REGEX);
    if (match?.[1]) {
      const name = match[1].charAt(0).toLowerCase() + match[1].slice(1);
      const value = element.dataset[key];
      if (value !== undefined) {
        metadata[name] = value;
      }
    }
  }
  return metadata;
}

let triggerScanInterval: ReturnType<typeof setInterval> | null = null;

function startTriggerScanning(embed: Embed): void {
  if (triggerScanInterval) {
    return;
  }
  triggerScanInterval = setInterval(
    () => bindTriggers(embed),
    SCAN_INTERVAL_MS
  );
  bindTriggers(embed);
}

function stopTriggerScanning(): void {
  if (triggerScanInterval) {
    clearInterval(triggerScanInterval);
    triggerScanInterval = null;
  }
}

function bindTriggers(embed: Embed): void {
  for (const trigger of findTriggers()) {
    if (trigger.dataset.feebloBound === "true") {
      continue;
    }
    trigger.dataset.feebloBound = "true";

    const handleClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const metadata = extractTriggerMetadata(trigger);
      if (metadata.board) {
        embed.setBoard(metadata.board);
      }
      embed.open(trigger, metadata);
    };

    trigger.addEventListener("click", handleClick, { passive: false });
  }
}

// ---------------------------------------------------------------------------
// Global listeners (shared across embeds)
// ---------------------------------------------------------------------------

let globalCleanup: (() => void) | null = null;

function setupGlobalListeners(): () => void {
  if (globalCleanup) {
    return globalCleanup;
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

  return globalCleanup;
}

// ---------------------------------------------------------------------------
// Embed class
// ---------------------------------------------------------------------------

class Embed {
  options: EmbedOptions;
  container: HTMLDivElement;
  organizationId: string;
  private readonly iframe: HTMLIFrameElement;
  private identity: NormalizedUserIdentity | null;
  private isLoaded = false;
  private isOpen = false;
  private pendingBoard: string | null = null;
  private submittedFeedbackSent = false;
  private cleanupPositioning: (() => void) | null = null;
  private currentTrigger: HTMLElement | null = null;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;

  constructor(organizationId: string, options: EmbedOptions) {
    this.organizationId = organizationId;
    this.options = options;
    this.identity = options.user ? normalizeUserIdentity(options.user) : null;
    this.iframe = createIframe(organizationId, options);
    this.container = this.createContainer();

    setupGlobalListeners();
    startTriggerScanning(this);
  }

  private createContainer(): HTMLDivElement {
    const { root, containerStyles, onError, onHeightChange, onClose } =
      this.options;

    const existing = document.getElementById(
      CONTAINER_ID
    ) as CleanupContainer | null;
    if (existing) {
      existing._feebloCleanup?.();
      existing.remove();
    }

    const container = document.createElement("div");
    container.id = CONTAINER_ID;
    Object.assign(container.style, CONTAINER_STYLES, containerStyles);
    container.appendChild(this.iframe);

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== new URL(this.iframe.src).origin) {
        return;
      }

      const message = event.data as IncomingMessage;
      switch (message?.event) {
        case "ERROR": {
          onError?.(
            new EmbedError({
              code: message.data?.code ?? "",
              message: message.data?.message ?? "",
            })
          );
          break;
        }
        case "PAGE_HEIGHT": {
          const height = message.data?.height;
          if (height !== undefined && height > 80) {
            container.style.height = `${height}px`;
            onHeightChange?.(height);
          }
          break;
        }
        case "CLOSE": {
          this.close();
          onClose?.();
          break;
        }
        case "READY": {
          if (!this.isLoaded) {
            this.isLoaded = true;
            this.sendIdentify();
            emitWidgetEvent("widgetReady");
          }
          break;
        }
        case "WIDGET_OPENED": {
          emitWidgetEvent("widgetOpened", message.data);
          break;
        }
        case "FEEDBACK_SUBMITTED": {
          if (!this.submittedFeedbackSent) {
            this.submittedFeedbackSent = true;
            emitWidgetEvent("feedbackSubmitted", message.data?.post);
          }
          break;
        }
        default: {
          break;
        }
      }
    };

    this.iframe.addEventListener(
      "load",
      () => {
        if (!this.isLoaded) {
          this.isLoaded = true;
          this.sendIdentify();
          emitWidgetEvent("widgetReady");
        }
      },
      { once: true }
    );

    window.addEventListener("message", handleMessage);

    (container as CleanupContainer)._feebloCleanup = () => {
      window.removeEventListener("message", handleMessage);
    };

    (root ?? document.body).appendChild(container);
    return container;
  }

  open(trigger?: HTMLElement, _metadata?: Record<string, string>): void {
    if (this.isOpen) {
      return;
    }

    this.isOpen = true;
    this.container.style.display = "";

    if (trigger) {
      this.currentTrigger = trigger;
      this.cleanupPositioning = createFloatingInstance(trigger, this.container);
      this.addCloseListeners();
    }

    if (this.pendingBoard) {
      this.sendSetBoard(this.pendingBoard);
      this.pendingBoard = null;
    }

    requestAnimationFrame(() => {
      this.container.style.opacity = "1";
    });

    this.iframe.contentWindow?.postMessage(
      { event: "SHOW" },
      new URL(this.iframe.src).origin
    );

    emitWidgetEvent("widgetOpened");
  }

  close(): void {
    if (!this.isOpen) {
      return;
    }

    this.removeCloseListeners();
    this.cleanupPositioning?.();
    this.cleanupPositioning = null;
    this.currentTrigger = null;

    this.container.style.opacity = "0";
    this.isOpen = false;

    setTimeout(() => {
      if (!this.isOpen) {
        this.container.style.display = "none";
      }
    }, FADE_DURATION_MS);

    this.iframe.contentWindow?.postMessage(
      { event: "HIDE" },
      new URL(this.iframe.src).origin
    );
  }

  setBoard(board: string): void {
    if (this.isLoaded && this.isOpen) {
      this.sendSetBoard(board);
    } else {
      this.pendingBoard = board;
    }
  }

  private sendSetBoard(board: string): void {
    this.iframe.contentWindow?.postMessage(
      { event: "SET_BOARD", data: { board } },
      new URL(this.iframe.src).origin
    );
  }

  identify(user: UserIdentity): void {
    this.identity = normalizeUserIdentity(user);
    if (this.isLoaded) {
      this.sendIdentify();
    }
  }

  private sendIdentify(): void {
    if (!this.identity) {
      return;
    }
    this.iframe.contentWindow?.postMessage(
      { event: "IDENTIFY", data: compact(this.identity) },
      new URL(this.iframe.src).origin
    );
  }

  private addCloseListeners(): void {
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        this.close();
      }
    };
    this.outsideClickHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!this.container.contains(target) && this.currentTrigger !== target) {
        this.close();
      }
    };
    document.addEventListener("keydown", this.escHandler);
    document.addEventListener("click", this.outsideClickHandler, {
      capture: true,
    });
  }

  private removeCloseListeners(): void {
    if (this.escHandler) {
      document.removeEventListener("keydown", this.escHandler);
      this.escHandler = null;
    }
    if (this.outsideClickHandler) {
      document.removeEventListener("click", this.outsideClickHandler, {
        capture: true,
      });
      this.outsideClickHandler = null;
    }
  }

  destroy(): void {
    this.removeCloseListeners();
    this.cleanupPositioning?.();
    this.cleanupPositioning = null;

    const container = document.getElementById(
      CONTAINER_ID
    ) as CleanupContainer | null;
    if (container) {
      container._feebloCleanup?.();
      container.remove();
    }

    if (currentEmbed === this) {
      stopTriggerScanning();
      globalCleanup?.();
    }
  }
}

// ---------------------------------------------------------------------------
// Iframe factory
// ---------------------------------------------------------------------------

function createIframe(
  organizationId: string,
  options: EmbedOptions
): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  const hostname = window.location.hostname;
  const port = window.location.port;
  const baseUrl =
    options.baseUrl ??
    (hostname === "localhost"
      ? `http://localhost:${port || "3001"}`
      : "https://app.feeblo.com");
  const params = new URLSearchParams();
  if (options.theme) {
    params.set("theme", options.theme);
  }

  const path = `${baseUrl}/feedback-widget/${organizationId}`;
  const query = params.toString();
  iframe.src = query ? `${path}?${query}` : path;
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.border = "none";
  iframe.setAttribute("allow", "clipboard-write");
  return iframe;
}

// ---------------------------------------------------------------------------
// Shared embed instance
// ---------------------------------------------------------------------------

let currentEmbed: Embed | null = null;
let currentOrgId: string | null = null;

function init(
  organizationId: string,
  options: EmbedOptions = {}
): FeebloWidget {
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new EmbedError({
      code: "INVALID_ORG",
      message:
        "[feeblo-sdk] `organizationId` is required. Pass the id shown under Settings → Widget → Installation.",
    });
  }

  if (!isBrowser()) {
    return {
      identify: () => undefined,
      destroy: () => undefined,
      open: () => undefined,
      close: () => undefined,
      setBoard: () => undefined,
    };
  }

  if (currentEmbed && currentOrgId === organizationId) {
    if (options.user) {
      currentEmbed.identify(options.user);
    }
    return createWidgetProxy(currentEmbed);
  }

  if (currentEmbed) {
    currentEmbed.destroy();
  }

  const embed = new Embed(organizationId, options);
  currentEmbed = embed;
  currentOrgId = organizationId;

  return createWidgetProxy(embed);
}

function createWidgetProxy(embed: Embed): FeebloWidget {
  return {
    identify: embed.identify.bind(embed),
    destroy: () => {
      embed.destroy();
      if (currentEmbed === embed) {
        currentEmbed = null;
        currentOrgId = null;
      }
    },
    open: embed.open.bind(embed),
    close: embed.close.bind(embed),
    setBoard: embed.setBoard.bind(embed),
  };
}

export { init };

// ---------------------------------------------------------------------------
// Static Feeblo namespace
// ---------------------------------------------------------------------------

const Feeblo = {
  init,

  identify(user: UserIdentity): void {
    currentEmbed?.identify(user);
  },

  open(): void {
    currentEmbed?.open();
  },

  close(): void {
    currentEmbed?.close();
  },

  setBoard(board: string): void {
    currentEmbed?.setBoard(board);
  },

  destroy(): void {
    currentEmbed?.destroy();
    currentEmbed = null;
    currentOrgId = null;
  },

  on(event: string, callback: EventCallback): () => void {
    if (!isBrowser()) {
      return () => undefined;
    }

    const listener = callback as EventListener;

    if (event === "*") {
      window.addEventListener("widgetReady", listener);
      window.addEventListener("widgetOpened", listener);
      window.addEventListener("feedbackSubmitted", listener);
      return () => {
        window.removeEventListener("widgetReady", listener);
        window.removeEventListener("widgetOpened", listener);
        window.removeEventListener("feedbackSubmitted", listener);
      };
    }

    window.addEventListener(event, listener);
    return () => window.removeEventListener(event, listener);
  },

  off(event: string, callback: EventCallback): void {
    if (!isBrowser()) {
      return;
    }
    window.removeEventListener(event, callback as EventListener);
  },
};

export { Feeblo };

// ---------------------------------------------------------------------------
// Auto-init from script tag
// ---------------------------------------------------------------------------

function getAutoConfig(): { orgId: string; options: EmbedOptions } | null {
  const globalConfig = (window as unknown as Record<string, unknown>)
    .feebloConfig as Partial<{
    orgId: string;
    organizationId: string;
    baseUrl: string;
    theme: string;
  }> | null;

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

  const options: EmbedOptions = {};
  if (baseUrl) {
    options.baseUrl = baseUrl;
  }
  if (theme) {
    options.theme = theme;
  }

  return { orgId, options };
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

if (isBrowser()) {
  const autoConfig = getAutoConfig();
  if (autoConfig) {
    init(autoConfig.orgId, autoConfig.options);
  }
}
