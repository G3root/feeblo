import { vi } from "vitest";

import type { Logger } from "../src/debug";
import { setEmbedDependencies } from "../src/instance";
import type { EmbedOptions, OutgoingMessage } from "../src/types";

export const MOCK_ORIGIN = "http://localhost:3001";
export const fakePostMessage =
  vi.fn<(message: OutgoingMessage, targetOrigin: string) => void>();

export function installTestEmbedDependencies(): () => void {
  return setEmbedDependencies({
    createIframe: (
      _organizationId: string,
      _options: EmbedOptions,
      _logger?: Logger
    ) => {
      const iframe = document.createElement("iframe");
      iframe.src = "about:blank";
      Object.defineProperty(iframe, "contentWindow", {
        value: { postMessage: fakePostMessage },
        writable: true,
        configurable: true,
      });
      return iframe;
    },
    iframeOrigin: (_iframe: HTMLIFrameElement) => MOCK_ORIGIN,
    createFloatingInstance:
      (_reference: HTMLElement, _floating: HTMLElement, _logger?: Logger) =>
      () =>
        undefined,
  });
}

export function triggerIframeLoad(): void {
  document.querySelector("iframe")?.dispatchEvent(new Event("load"));
}
