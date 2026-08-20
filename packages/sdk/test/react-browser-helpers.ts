import { afterEach, vi } from "vitest";

import type { Logger } from "../src/debug";
import { Feeblo } from "../src/index";
import { setEmbedDependencies } from "../src/instance";
import type { EmbedOptions, OutgoingMessage } from "../src/types";

export const MOCK_ORIGIN = "http://localhost:3001";
export const fakePostMessage =
  vi.fn<(message: OutgoingMessage, targetOrigin: string) => void>();

let restoreEmbedDependencies: (() => void) | undefined;

export function installTestEmbedDependencies(): () => void {
  restoreEmbedDependencies = setEmbedDependencies({
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
  return restoreEmbedDependencies;
}

export function triggerIframeLoad(): void {
  document.querySelector("iframe")?.dispatchEvent(new Event("load"));
}

// Shared teardown for every test that installs the embed dependencies:
// reset the singleton and remove leftover DOM so tests never leak widgets
// into each other.
afterEach(() => {
  restoreEmbedDependencies?.();
  fakePostMessage.mockClear();
  Feeblo.destroy();
  document.getElementById("feeblo-embed-container")?.remove();
  document.getElementById("feeblo-widget-launcher")?.remove();
});
