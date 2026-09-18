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

/**
 * Hosts where plain HTTP may carry the token: local development only. HTTPS
 * is required everywhere else because the fragment token is a bearer
 * credential that a network observer could otherwise replay.
 */
const isLoopbackHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
};

/**
 * Limits which link hosts may receive the SSO token. The SSO token is a
 * bearer credential, so an injected `<a data-feeblo-link href="https://evil">`
 * must not be able to exfiltrate it. Allowed targets are the page origin, the
 * configured widget base URL origin, explicitly listed `autoLoginOrigins`,
 * and subdomains of the embedding page (the common
 * `yourdomain.com` -> `feedback.yourdomain.com` board layout).
 *
 * Plain HTTP is only accepted for loopback hosts; every other target must be
 * HTTPS, including origins supplied through `baseUrl` or `autoLoginOrigins`.
 */
export function isAutoLoginTargetAllowed(
  href: string,
  allowedOrigins: readonly string[]
): boolean {
  try {
    const url = new URL(href, window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
      return false;
    }
    if (allowedOrigins.includes(url.origin)) {
      return true;
    }
    const page = new URL(window.location.href);
    return (
      url.hostname !== "" &&
      url.protocol === page.protocol &&
      url.port === page.port &&
      (url.hostname === page.hostname ||
        url.hostname.endsWith(`.${page.hostname}`))
    );
  } catch {
    return false;
  }
}

export function startLinkAuthentication(
  target: LinkTarget,
  logger?: Logger,
  options?: { readonly allowedOrigins?: readonly string[] | undefined }
): () => void {
  const allowedOrigins = options?.allowedOrigins ?? [window.location.origin];
  const handleInteraction = (event: Event) => {
    const link = findFeebloLink(event.target);
    const token = target.getAutoLoginToken();
    if (!(link && token)) {
      return;
    }
    if (!isAutoLoginTargetAllowed(link.href, allowedOrigins)) {
      if (logger?.enabled) {
        logger("link", "blocked", { origin: link.origin });
      }
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
