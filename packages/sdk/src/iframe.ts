import { normalizeWidgetConfig } from "./config";
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
  const config = normalizeWidgetConfig(options);
  params.set("mode", config.mode);
  params.set("modules", config.modules.join(","));
  if (options.theme) {
    params.set("theme", options.theme);
  }
  if (options.locale) {
    params.set("locale", options.locale);
  }
  if (options.defaultBoard) {
    params.set("board", options.defaultBoard);
  }

  const path = `${baseUrl}/feedback-widget/${organizationId}`;
  const query = params.toString();
  const initialRoute = config.modules[0] === "updates" ? "#/updates" : "#/";
  iframe.src = `${query ? `${path}?${query}` : path}${initialRoute}`;
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.border = "none";
  if (config.mode === "hub") {
    iframe.title = "Feeblo Hub";
  } else if (config.mode === "updates") {
    iframe.title = "Feeblo updates widget";
  } else {
    iframe.title = "Feeblo feedback widget";
  }
  iframe.setAttribute(
    "sandbox",
    "allow-scripts allow-forms allow-same-origin allow-popups allow-downloads"
  );
  iframe.setAttribute("allow", "clipboard-write");

  if (logger?.enabled) {
    logger("config", "iframe", { baseUrl, src: iframe.src });
  }
  return iframe;
}

export function iframeOrigin(iframe: HTMLIFrameElement): string {
  return new URL(iframe.src).origin;
}
