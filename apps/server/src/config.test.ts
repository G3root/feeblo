import { describe, expect, it } from "@effect/vitest";
import { isTrustedProxy } from "@feeblo/domain/client-ip";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { ServerConfig } from "./config";

const requiredServerEnvironment = {
  APP_ROOT_DOMAIN: "example.test",
  APP_URL: "https://example.test",
  API_URL: "https://api.example.test",
};

const loadServerConfig = (
  environment: Record<string, string | undefined> = {}
) =>
  ServerConfig.pipe(
    Effect.provide(
      ServerConfig.layer.pipe(
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              ...requiredServerEnvironment,
              ...environment,
            })
          )
        )
      )
    )
  );

describe("ServerConfig client IP proxy trust", () => {
  it.effect("does not trust proxy headers by default", () =>
    Effect.gen(function* () {
      const config = yield* loadServerConfig();

      expect(isTrustedProxy("10.0.0.1", config.clientIpProxyTrust)).toBe(false);
    })
  );

  it.effect("parses and trims comma-separated IPv4 and IPv6 CIDRs", () =>
    Effect.gen(function* () {
      const config = yield* loadServerConfig({
        TRUSTED_PROXY_IPS: " 10.0.0.0/8, 2001:db8::/32 ,,",
      });

      expect(isTrustedProxy("10.1.2.3", config.clientIpProxyTrust)).toBe(true);
      expect(isTrustedProxy("2001:db8::7", config.clientIpProxyTrust)).toBe(
        true
      );
      expect(isTrustedProxy("203.0.113.7", config.clientIpProxyTrust)).toBe(
        false
      );
    })
  );

  it.effect("supports explicitly trusting every proxy peer", () =>
    Effect.gen(function* () {
      const config = yield* loadServerConfig({ TRUST_PROXY_HEADERS: "true" });

      expect(isTrustedProxy("203.0.113.7", config.clientIpProxyTrust)).toBe(
        true
      );
    })
  );

  it.effect("fails startup for a malformed trust-all boolean", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        loadServerConfig({ TRUST_PROXY_HEADERS: "sometimes" })
      );

      expect(Exit.isFailure(exit)).toBe(true);
    })
  );

  it.effect("fails startup for a malformed trusted proxy CIDR", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        loadServerConfig({ TRUSTED_PROXY_IPS: "10.0.0.0/99" })
      );

      expect(Exit.isFailure(exit)).toBe(true);
    })
  );
});
