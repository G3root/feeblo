import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ServerConfigValue } from "../config";

const isLocalDevHost = (host: string): boolean =>
  host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");

const parseUrl = (value: string): URL | null =>
  Option.getOrNull(Schema.decodeUnknownOption(Schema.URLFromString)(value));

export const makeIsAllowedOrigin =
  (config: ServerConfigValue) =>
  (origin: string | undefined): boolean => {
    // Missing Origin headers come from non-browser clients and same-origin
    // navigations. CORS cannot gate them, so credentials-enabled,
    // state-changing routes must not rely on CORS alone for cross-site
    // protection.
    if (!origin) {
      return true;
    }

    const originUrl = parseUrl(origin);
    const appUrl = parseUrl(config.appUrl);
    const apiUrl = parseUrl(config.apiUrl);
    if (!(originUrl && appUrl && apiUrl)) {
      return false;
    }

    const originHost = originUrl.hostname;
    const appRootDomainHost = config.appRootDomain.includes(":")
      ? config.appRootDomain.split(":")[0]
      : config.appRootDomain;

    if (originUrl.origin === apiUrl.origin) {
      return true;
    }
    if (originUrl.origin === appUrl.origin) {
      return true;
    }

    if (
      config.nodeEnv === "development" &&
      isLocalDevHost(originHost) &&
      isLocalDevHost(appRootDomainHost ?? "")
    ) {
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

    return false;
  };
