import UrlSlugify from "slugify";

export function slugify(str: string) {
  return UrlSlugify(str, { lower: true });
}

interface ExtractSubdomainContext {
  rootDomain: string;
  url: string;
}

export const extractSubdomain = ({
  url,
  rootDomain,
}: ExtractSubdomainContext) => {
  const { hostname } = new URL(url);
  const RootDomainHost = rootDomain.split(":")[0];

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return null;
  }

  if (hostname.endsWith(".localhost")) {
    return hostname.slice(0, hostname.indexOf(".localhost"));
  }

  if (
    hostname !== RootDomainHost &&
    hostname !== `www.${RootDomainHost}` &&
    hostname.endsWith(`.${RootDomainHost}`) &&
    RootDomainHost
  ) {
    return hostname.slice(0, hostname.length - RootDomainHost.length - 1);
  }

  return null;
};

const DEFAULT_RESERVED_SUBDOMAINS = [
  "app",
  "dashboard",
  "www",
  "localhost",
  "127.0.0.1",
  "staging-api",
  "staging",
  "staging-app",
  "dev",
  "test",
  "demo",
  "feeblo",
  "s",
  "feedback-widget",
  // Common infrastructure names: reserving them prevents a workspace from
  // squatting a subdomain that conventionally belongs to the platform (e.g.
  // api.<rootDomain>, mail.<rootDomain>).
  "api",
  "api-v1",
  "graphql",
  "auth",
  "accounts",
  "login",
  "admin",
  "mail",
  "smtp",
  "imap",
  "support",
  "help",
  "status",
  "docs",
  "blog",
  "cdn",
  "assets",
  "static",
  "media",
  "billing",
  "portal",
  "settings",
  "security",
  "legal",
  "privacy",
  "terms",
  "contact",
  "newsletter",
  "community",
  "forum",
  "roadmap",
  "changelog",
];

export function getReservedSubdomains(): string[] {
  const envValue = process.env.RESERVED_SUBDOMAINS;
  const envSubdomains = envValue
    ? envValue
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  // The env var is additive: it can reserve extra names but never removes the
  // platform defaults (including the infrastructure names above).
  return Array.from(
    new Set([...DEFAULT_RESERVED_SUBDOMAINS, ...envSubdomains])
  );
}
