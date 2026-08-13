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
  // Put the SSO token in the URL fragment instead of the query string: the
  // fragment is never sent to the server and never appears in the Referer
  // header, so it cannot leak through access logs, proxies, or analytics. The
  // public board reads and strips it before rendering. Any fragment already
  // present on the link (e.g. a deep-link anchor) is preserved alongside the
  // token.
  url.searchParams.delete("ssoToken");
  const hashEntries = url.hash
    .slice(1)
    .split("&")
    .filter((entry) => entry && !new URLSearchParams(entry).has("ssoToken"));
  hashEntries.push(`ssoToken=${encodeURIComponent(token)}`);
  url.hash = hashEntries.join("&");
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
