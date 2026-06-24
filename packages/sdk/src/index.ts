const CONTAINER_ID = "feeblo-embed-container";
const FEEDBACK_ATTRIBUTE = "data-feeblo-feedback";

const DEFAULT_CONTAINER_STYLES: Partial<CSSStyleDeclaration> = {
  position: "relative",
  maxWidth: "1024px",
  height: "600px",
  margin: "0 auto",
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

interface NormalizedWidgetCompany {
  id: string;
  monthlySpend?: number | undefined;
  name: string;
}

interface NormalizedUserIdentity {
  avatar?: string | undefined;
  companies?: NormalizedWidgetCompany[] | undefined;
  email?: string | undefined;
  firstName?: string | undefined;
  id: string;
  lastName?: string | undefined;
  token?: string | undefined;
}

const COMPANY_KEYS: readonly (keyof WidgetCompany)[] = [
  "id",
  "name",
  "monthlySpend",
];

function normalizeCompany(company: WidgetCompany): NormalizedWidgetCompany {
  return pickDefined(company, COMPANY_KEYS) as NormalizedWidgetCompany;
}

function pickDefined<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function normalizeUserIdentity(user: UserIdentity): NormalizedUserIdentity {
  const { id, ...rest } = user;
  if (!id) {
    throw new EmbedError({
      code: "INVALID_IDENTITY",
      message: "[feeblo-sdk] `id` is required to identify a widget user.",
    });
  }

  const base = pickDefined(rest, [
    "email",
    "firstName",
    "lastName",
    "avatar",
    "token",
  ]);

  const companies = rest.companies?.map(normalizeCompany) ?? undefined;

  return { id, ...base, ...(companies ? { companies } : {}) };
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
  destroy: () => void;
  identify: (user: UserIdentity) => void;
  open: () => void;
  close: () => void;
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
  data: {
    action: string;
    setBoard?: string;
  };
};

type CleanupContainer = HTMLDivElement & { _feebloCleanup?: () => void };

export type FeebloEventName =
  | "widgetReady"
  | "widgetOpened"
  | "feedbackSubmitted";

export interface FeebloEventDetail {
  data: unknown;
  type: string;
  namespace: string;
}

type EventCallback = (e: CustomEvent<FeebloEventDetail>) => void;

function emitWidgetEvent(type: string, data?: unknown): void {
  const event = new CustomEvent<FeebloEventDetail>(type, {
    detail: { data, type, namespace: "feeblo" },
  });
  window.dispatchEvent(event);
}

let globalCleanup: (() => void) | null = null;

function setupGlobalListeners(): () => void {
  if (globalCleanup) {
    return globalCleanup;
  }

  const handleClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const button = target.closest(`[${FEEDBACK_ATTRIBUTE}]`);
    if (button && currentEmbed) {
      e.preventDefault();
      e.stopPropagation();
      currentEmbed.open();
    }
  };

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

  document.addEventListener("click", handleClick, true);
  window.addEventListener("message", handleExternalMessage);

  globalCleanup = () => {
    document.removeEventListener("click", handleClick, true);
    window.removeEventListener("message", handleExternalMessage);
    globalCleanup = null;
  };

  return globalCleanup;
}

class Embed {
  options: EmbedOptions;
  container: HTMLDivElement;
  organizationId: string;
  private readonly iframe: HTMLIFrameElement;
  private identity: NormalizedUserIdentity | null;
  private isLoaded = false;
  private isOpen = true;
  private pendingBoard: string | null = null;
  private submittedFeedbackSent = false;

  constructor(organizationId: string, options: EmbedOptions) {
    this.organizationId = organizationId;
    this.options = options;
    this.identity = options.user ? normalizeUserIdentity(options.user) : null;
    console.debug("[feeblo-sdk] Initializing.", { organizationId, options });
    this.iframe = createIframe(organizationId, options);
    this.container = this.renderEmbed();

    setupGlobalListeners();
  }

  private renderEmbed(): HTMLDivElement {
    console.debug("[feeblo-sdk] Rendering embed.");
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
    Object.assign(container.style, {
      ...DEFAULT_CONTAINER_STYLES,
      ...containerStyles,
    });
    container.appendChild(this.iframe);

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== new URL(this.iframe.src).origin) {
        return;
      }

      const message = event.data as IncomingMessage;
      switch (message?.event) {
        case "ERROR": {
          const error = new EmbedError({
            code: message.data?.code ?? "",
            message: message.data?.message ?? "",
          });
          onError?.(error);
          break;
        }
        case "PAGE_HEIGHT": {
          const height = message.data?.height;
          if (height !== undefined) {
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

    const handleLoad = () => {
      if (!this.isLoaded) {
        this.isLoaded = true;
        this.sendIdentify();
        emitWidgetEvent("widgetReady");
      }
    };

    window.addEventListener("message", handleMessage);
    this.iframe.addEventListener("load", handleLoad);

    (container as CleanupContainer)._feebloCleanup = () => {
      window.removeEventListener("message", handleMessage);
      this.iframe.removeEventListener("load", handleLoad);
    };

    (root ?? document.body).appendChild(container);
    return container;
  }

  open(): void {
    this.isOpen = true;
    this.container.style.display = "";

    if (this.pendingBoard) {
      this.sendSetBoard(this.pendingBoard);
      this.pendingBoard = null;
    }

    this.iframe.contentWindow?.postMessage(
      { event: "SHOW" },
      new URL(this.iframe.src).origin
    );

    emitWidgetEvent("widgetOpened");
  }

  close(): void {
    this.isOpen = false;
    this.container.style.display = "none";

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
    if (this.identity === null) {
      return;
    }
    this.iframe.contentWindow?.postMessage(
      { event: "IDENTIFY", data: compact(this.identity) },
      new URL(this.iframe.src).origin
    );
  }

  destroy(): void {
    const container = document.getElementById(
      CONTAINER_ID
    ) as CleanupContainer | null;
    if (container) {
      container._feebloCleanup?.();
      container.remove();
    }

    if (currentEmbed === this) {
      globalCleanup?.();
    }
  }
}

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
    };
  }

  if (currentEmbed && currentOrgId === organizationId) {
    if (options.user) {
      currentEmbed.identify(options.user);
    }
    return {
      identify: currentEmbed.identify.bind(currentEmbed),
      destroy: currentEmbed.destroy.bind(currentEmbed),
      open: currentEmbed.open.bind(currentEmbed),
      close: currentEmbed.close.bind(currentEmbed),
    };
  }

  if (currentEmbed) {
    currentEmbed.destroy();
  }

  const embed = new Embed(organizationId, options);
  currentEmbed = embed;
  currentOrgId = organizationId;
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
  };
}

export { init };

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
    return () => {
      window.removeEventListener(event, listener);
    };
  },

  off(event: string, callback: EventCallback): void {
    if (!isBrowser()) {
      return;
    }
    window.removeEventListener(event, callback as EventListener);
  },
};

export { Feeblo };

function getAutoConfig(): {
  orgId: string;
  options: EmbedOptions;
} | null {
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
  if (document.currentScript) {
    const script = document.currentScript as HTMLScriptElement;
    if (hasFeebloSource(script.src)) {
      return script;
    }
  }

  const scripts = document.getElementsByTagName("script");
  for (const script of scripts) {
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
