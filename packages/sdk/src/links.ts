import type { Logger } from "./debug";

export const LINK_ATTRIBUTE = "data-feeblo-link";

type LinkTarget = {
  getAutoLoginToken: () => string | undefined;
};

const LINK_EVENTS = ["mousedown", "click", "contextmenu", "focusin"] as const;

function findFeebloLink(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const link = target.closest<HTMLAnchorElement>(`a[${LINK_ATTRIBUTE}]`);
  return link?.isConnected ? link : null;
}

export function authenticateLink(link: HTMLAnchorElement, token: string): void {
  const url = new URL(link.href, window.location.href);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return;
  }
  url.searchParams.set("ssoToken", token);
  link.href = url.toString();
}

export function startLinkAuthentication(
  target: LinkTarget,
  logger?: Logger
): () => void {
  const handleInteraction = (event: Event) => {
    const link = findFeebloLink(event.target);
    const token = target.getAutoLoginToken();
    if (!(link && token)) {
      return;
    }

    authenticateLink(link, token);
    if (logger?.enabled) {
      logger("link", "authenticated", { href: link.href });
    }
  };

  for (const eventName of LINK_EVENTS) {
    document.addEventListener(eventName, handleInteraction, true);
  }

  return () => {
    for (const eventName of LINK_EVENTS) {
      document.removeEventListener(eventName, handleInteraction, true);
    }
  };
}
