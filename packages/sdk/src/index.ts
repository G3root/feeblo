const CONTAINER_ID = "feeblo-embed-container";

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
}

type IncomingMessage =
  | { event: "ERROR"; data?: { code?: string; message?: string } }
  | { event: "PAGE_HEIGHT"; data?: { height?: number } }
  | { event: "CLOSE" }
  | { event: "READY" };

type CleanupContainer = HTMLDivElement & { _feebloCleanup?: () => void };

class Embed {
  options: EmbedOptions;
  container: HTMLDivElement;
  organizationId: string;
  private readonly iframe: HTMLIFrameElement;
  private identity: NormalizedUserIdentity | null;
  private isLoaded = false;

  constructor(organizationId: string, options: EmbedOptions) {
    this.organizationId = organizationId;
    this.options = options;
    this.identity = options.user ? normalizeUserIdentity(options.user) : null;
    console.debug("[feeblo-sdk] Initializing.", { organizationId, options });
    this.iframe = createIframe(organizationId, options);
    this.container = this.renderEmbed();
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
          onClose?.();
          break;
        }
        case "READY": {
          this.isLoaded = true;
          this.sendIdentify();
          break;
        }
        default: {
          break;
        }
      }
    };

    const handleLoad = () => {
      this.isLoaded = true;
      this.sendIdentify();
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

export function init(
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
      identify: (_user: UserIdentity) => undefined,
      destroy: () => undefined,
    };
  }

  if (currentEmbed && currentOrgId === organizationId) {
    if (options.user) {
      currentEmbed.identify(options.user);
    }
    return {
      identify: currentEmbed.identify.bind(currentEmbed),
      destroy: currentEmbed.destroy.bind(currentEmbed),
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
  };
}

export const feeblo = { init };
