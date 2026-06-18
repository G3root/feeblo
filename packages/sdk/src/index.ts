const CONTAINER_ID = "feeblo-embed-container";

const DEFAULT_CONTAINER_STYLES: Partial<CSSStyleDeclaration> = {
  position: "relative",
  maxWidth: "1024px",
  height: "600px",
  margin: "0 auto",
};

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

export interface EmbedOptions {
  baseUrl?: string | undefined;
  containerStyles?: Partial<CSSStyleDeclaration> | undefined;
  onError?: ((error: EmbedError) => void) | undefined;
  onHeightChange?: ((height: number) => void) | undefined;
  root?: HTMLElement | undefined;
  theme?: string | undefined;
}

type EmbedMessage =
  | { event: "ERROR"; data?: { code?: string; message?: string } }
  | { event: "PAGE_HEIGHT"; data?: { height?: number } };

type CleanupContainer = HTMLDivElement & { _feebloCleanup?: () => void };

class Embed {
  options: EmbedOptions;
  container: HTMLDivElement;
  organizationId: string;

  constructor(organizationId: string, options: EmbedOptions) {
    this.organizationId = organizationId;
    this.options = options;
    console.debug("[Feeblo] Initializing.", { organizationId, options });
    this.container = this.renderEmbed();
  }

  private renderEmbed(): HTMLDivElement {
    console.debug("[Feeblo] Rendering embed.");
    const { root, containerStyles, onError, onHeightChange } = this.options;
    const existing = document.getElementById(
      CONTAINER_ID
    ) as CleanupContainer | null;
    if (existing) {
      return existing;
    }

    const container = document.createElement("div");
    container.id = CONTAINER_ID;
    Object.assign(container.style, {
      ...DEFAULT_CONTAINER_STYLES,
      ...containerStyles,
    });

    const iframe = createIframe(this.organizationId, this.options);
    container.appendChild(iframe);

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== new URL(iframe.src).origin) {
        return;
      }

      const message = event.data as EmbedMessage;
      switch (message.event) {
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
        default: {
          break;
        }
      }
    };

    window.addEventListener("message", handleMessage);
    (container as CleanupContainer)._feebloCleanup = () => {
      window.removeEventListener("message", handleMessage);
    };

    (root ?? document.body).appendChild(container);
    return container;
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

export function init(
  organizationId: string,
  options: EmbedOptions = {}
): { destroy: () => void } {
  if (document.getElementById(CONTAINER_ID)) {
    console.warn("[Feeblo] Embed already initialized. Skipping.");
    return {
      destroy: () => {
        const container = document.getElementById(
          CONTAINER_ID
        ) as CleanupContainer | null;
        if (container) {
          container._feebloCleanup?.();
          container.remove();
        }
      },
    };
  }

  const embed = new Embed(organizationId, options);
  return { destroy: embed.destroy.bind(embed) };
}

export const feeblo = { init };
