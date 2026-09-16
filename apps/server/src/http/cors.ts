import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ServerConfigValue } from "../config";

/** Config fields that determine whether a browser origin may call the API. */
export type AllowedOriginConfig = Pick<
  ServerConfigValue,
  "appUrl" | "apiUrl" | "appRootDomain" | "nodeEnv"
> & {
  /** Operator-supplied `AUTH_TRUSTED_ORIGINS` entries; wildcards allowed. */
  readonly authTrustedOrigins?: readonly string[] | undefined;
};

const isLocalDevHost = (host: string): boolean =>
  host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");

const parseUrl = (value: string): URL | null =>
  Option.getOrNull(Schema.decodeUnknownOption(Schema.URLFromString)(value));

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

const wildcardToRegExp = (pattern: string): RegExp =>
  new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`, "i");

interface TrustedOriginMatcher {
  readonly hasScheme: boolean;
  readonly regex: RegExp;
}

const compileTrustedOriginMatchers = (
  patterns: readonly string[]
): readonly TrustedOriginMatcher[] =>
  patterns.map((pattern) => ({
    hasScheme: pattern.includes("://"),
    regex: wildcardToRegExp(pattern),
  }));

/**
 * Matches one browser origin against the operator's `AUTH_TRUSTED_ORIGINS`
 * patterns using better-auth's documented shapes: exact origins, exact
 * hostnames (with or without port), and `*` wildcards such as
 * `*.feeblo.com` or `*.localhost:3001`.
 */
const matchesTrustedOrigin = (
  origin: string,
  originUrl: URL,
  matchers: readonly TrustedOriginMatcher[]
): boolean =>
  matchers.some(({ hasScheme, regex }) =>
    hasScheme
      ? regex.test(origin)
      : regex.test(originUrl.hostname) || regex.test(originUrl.host)
  );

export const makeIsAllowedOrigin =
  (config: AllowedOriginConfig) =>
  (origin: string | undefined): boolean => {
    // Constant configuration is parsed once when this predicate is created,
    // not on every CORS evaluation; only the untrusted Origin header is
    // parsed per request.
    const appUrl = parseUrl(config.appUrl);
    const apiUrl = parseUrl(config.apiUrl);
    const appRootDomainHost = config.appRootDomain.includes(":")
      ? (config.appRootDomain.split(":")[0] ?? "")
      : config.appRootDomain;
    const allowLocalDevHost =
      config.nodeEnv === "development" && isLocalDevHost(appRootDomainHost);
    const trustedOriginMatchers = compileTrustedOriginMatchers(
      config.authTrustedOrigins ?? []
    );

    // Missing Origin headers come from non-browser clients and same-origin
    // navigations. CORS cannot gate them, so credentials-enabled,
    // state-changing routes must not rely on CORS alone for cross-site
    // protection.
    if (!origin) {
      return true;
    }

    const originUrl = parseUrl(origin);
    if (!(originUrl && appUrl && apiUrl)) {
      return false;
    }

    const originHost = originUrl.hostname;

    if (originUrl.origin === apiUrl.origin) {
      return true;
    }
    if (originUrl.origin === appUrl.origin) {
      return true;
    }

    if (allowLocalDevHost && isLocalDevHost(originHost)) {
      return true;
    }

    if (
      appRootDomainHost !== "" &&
      originHost.endsWith(`.${appRootDomainHost}`) &&
      originUrl.protocol === appUrl.protocol &&
      originUrl.port === appUrl.port
    ) {
      return true;
    }

    return matchesTrustedOrigin(origin, originUrl, trustedOriginMatchers);
  };
