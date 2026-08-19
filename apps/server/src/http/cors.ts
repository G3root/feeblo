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
    const appHost = appUrl.hostname;
    const apiHost = apiUrl.hostname;
    const appRootDomainHost = config.appRootDomain.includes(":")
      ? config.appRootDomain.split(":")[0]
      : config.appRootDomain;

    if (originHost === apiHost) {
      return true;
    }
    if (originHost === appHost) {
      return true;
    }

    if (
      config.nodeEnv === "development" &&
      isLocalDevHost(originHost) &&
      isLocalDevHost(appRootDomainHost ?? "")
    ) {
      return true;
    }

    if (originHost.endsWith(`.${appRootDomainHost}`)) {
      return true;
    }

    return false;
  };
