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
];

export function getReservedSubdomains(): string[] {
  const envValue = process.env.RESERVED_SUBDOMAINS;
  if (envValue) {
    return envValue
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return DEFAULT_RESERVED_SUBDOMAINS;
}
