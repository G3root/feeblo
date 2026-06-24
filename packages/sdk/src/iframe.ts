import type { Logger } from "./debug";
import type { EmbedOptions } from "./types";

export function resolveBaseUrl(options: EmbedOptions): string {
  const hostname = window.location.hostname;
  const port = window.location.port;
  return (
    options.baseUrl ??
    (hostname === "localhost"
      ? `http://localhost:${port || "3001"}`
      : "https://app.feeblo.com")
  );
}

export function createIframe(
  organizationId: string,
  options: EmbedOptions,
  logger?: Logger
): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  const baseUrl = resolveBaseUrl(options);
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

  if (logger?.enabled) {
    logger("config", "iframe", { baseUrl, src: iframe.src });
  }
  return iframe;
}

export function iframeOrigin(iframe: HTMLIFrameElement): string {
  return new URL(iframe.src).origin;
}
