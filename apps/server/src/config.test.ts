import { describe, expect, it } from "@effect/vitest";
import { isTrustedProxy } from "@feeblo/domain/client-ip";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ServerConfig } from "./config";

const requiredServerEnvironment = {
  APP_ROOT_DOMAIN: "example.test",
  APP_URL: "https://example.test",
  API_URL: "https://api.example.test",
  INTEGRATION_ENCRYPTION_KEY: "test-integration-encryption-key",
};

const loadServerConfig = (environment: Record<string, string | undefined> = {}) =>
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

describe("ServerConfig integration encryption key", () => {
  it.effect("falls back to AUTH_ENCRYPTION_KEY when INTEGRATION_ENCRYPTION_KEY is unset", () =>
    Effect.gen(function* () {
      const config = yield* loadServerConfig({
        INTEGRATION_ENCRYPTION_KEY: undefined,
        AUTH_ENCRYPTION_KEY: "auth-encryption-fallback",
      });

      expect(Redacted.value(config.integrationEncryptionKey)).toBe(
        "auth-encryption-fallback"
      );
    })
  );

  it.effect("prefers INTEGRATION_ENCRYPTION_KEY over AUTH_ENCRYPTION_KEY", () =>
    Effect.gen(function* () {
      const config = yield* loadServerConfig({
        INTEGRATION_ENCRYPTION_KEY: "integration-specific-key",
        AUTH_ENCRYPTION_KEY: "auth-encryption-fallback",
      });

      expect(Redacted.value(config.integrationEncryptionKey)).toBe(
        "integration-specific-key"
      );
    })
  );

  it.effect("fails startup when neither INTEGRATION_ENCRYPTION_KEY nor AUTH_ENCRYPTION_KEY is set", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        loadServerConfig({
          INTEGRATION_ENCRYPTION_KEY: undefined,
          AUTH_ENCRYPTION_KEY: undefined,
        })
      );

      expect(Exit.isFailure(exit)).toBe(true);
    })
  );
});
