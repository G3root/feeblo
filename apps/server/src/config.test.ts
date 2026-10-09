import { describe, expect, it } from "@effect/vitest";
import { isTrustedProxy } from "@feeblo/domain/client-ip";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";

import { ServerConfig } from "./config";

const requiredServerEnvironment = {
  APP_ROOT_DOMAIN: "example.test",
  APP_URL: "https://example.test",
  AUTH_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
  API_URL: "https://api.example.test",
};

// A complete, non-placeholder media configuration, as a production deployment
// must provide (see docs/r2-production-checklist.md).
const productionMediaEnvironment = {
  MEDIA_PUBLIC_BASE_URL: "https://media.example.test",
  MEDIA_PUBLIC_BUCKET_NAME: "feeblo-media",
  MEDIA_UPLOAD_ACCESS_KEY_ID: "r2-access-key",
  MEDIA_UPLOAD_ENDPOINT: "https://account.r2.cloudflarestorage.com",
  MEDIA_UPLOAD_REGION: "auto",
  MEDIA_UPLOAD_SECRET_ACCESS_KEY: "r2-secret-key",
};

const loadServerConfig = (
  environment: Record<string, string | undefined> = {}
) =>
  ServerConfig.make.pipe(
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromUnknown({
        ...requiredServerEnvironment,
        ...environment,
      })
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

describe("ServerConfig integration worker concurrency", () => {
  it.effect("defaults to 5 connection and 25 global concurrency", () =>
    Effect.gen(function* () {
      const config = yield* loadServerConfig();

      expect(config.integrationConnectionConcurrency).toBe(5);
      expect(config.integrationGlobalConcurrency).toBe(25);
    })
  );

  it.effect("accepts valid concurrency overrides", () =>
    Effect.gen(function* () {
      const config = yield* loadServerConfig({
        INTEGRATION_CONNECTION_CONCURRENCY: "7",
        INTEGRATION_GLOBAL_CONCURRENCY: "40",
      });

      expect(config.integrationConnectionConcurrency).toBe(7);
      expect(config.integrationGlobalConcurrency).toBe(40);
    })
  );

  it.effect("rejects zero and non-numeric concurrency values", () =>
    Effect.gen(function* () {
      const zero = yield* Effect.exit(
        loadServerConfig({ INTEGRATION_CONNECTION_CONCURRENCY: "0" })
      );
      expect(Exit.isFailure(zero)).toBe(true);

      const globalZero = yield* Effect.exit(
        loadServerConfig({ INTEGRATION_GLOBAL_CONCURRENCY: "0" })
      );
      expect(Exit.isFailure(globalZero)).toBe(true);

      const nonNumeric = yield* Effect.exit(
        loadServerConfig({
          INTEGRATION_CONNECTION_CONCURRENCY: "abc",
          INTEGRATION_GLOBAL_CONCURRENCY: "abc",
        })
      );
      expect(Exit.isFailure(nonNumeric)).toBe(true);
    })
  );
});

describe("ServerConfig integration encryption key", () => {
  it.effect(
    "falls back to AUTH_ENCRYPTION_KEY when INTEGRATION_ENCRYPTION_KEY is unset",
    () =>
      Effect.gen(function* () {
        const config = yield* loadServerConfig({
          INTEGRATION_ENCRYPTION_KEY: undefined,
        });

        expect(Redacted.value(config.integrationEncryptionKey)).toBe(
          "0123456789abcdef0123456789abcdef"
        );
      })
  );

  it.effect("prefers INTEGRATION_ENCRYPTION_KEY over AUTH_ENCRYPTION_KEY", () =>
    Effect.gen(function* () {
      const config = yield* loadServerConfig({
        AUTH_ENCRYPTION_KEY: "auth-encryption-fallback",
        INTEGRATION_ENCRYPTION_KEY: "integration-specific-key",
      });

      expect(Redacted.value(config.integrationEncryptionKey)).toBe(
        "integration-specific-key"
      );
    })
  );

  it.effect(
    "fails startup when neither INTEGRATION_ENCRYPTION_KEY nor AUTH_ENCRYPTION_KEY is set",
    () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          loadServerConfig({
            AUTH_ENCRYPTION_KEY: undefined,
            INTEGRATION_ENCRYPTION_KEY: undefined,
          })
        );

        expect(Exit.isFailure(exit)).toBe(true);
      })
  );
});

describe("ServerConfig production rate-limit store", () => {
  it.effect("fails startup in production without REDIS_URL", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        loadServerConfig({
          ...productionMediaEnvironment,
          NODE_ENV: "production",
          REDIS_URL: undefined,
        })
      );

      expect(Exit.isFailure(exit)).toBe(true);
    })
  );

  it.effect("starts in production with REDIS_URL", () =>
    Effect.gen(function* () {
      const config = yield* loadServerConfig({
        ...productionMediaEnvironment,
        NODE_ENV: "production",
        REDIS_URL: "redis://redis:6379/0",
      });

      expect(config.redisUrl).toBe("redis://redis:6379/0");
    })
  );
});

describe("ServerConfig production media storage", () => {
  const production = {
    NODE_ENV: "production",
    REDIS_URL: "redis://redis:6379/0",
  };

  it.effect("starts in production with a complete media configuration", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        loadServerConfig({ ...production, ...productionMediaEnvironment })
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    })
  );

  it.effect("fails startup when a media variable is missing", () =>
    Effect.gen(function* () {
      for (const name of Object.keys(productionMediaEnvironment)) {
        const exit = yield* Effect.exit(
          loadServerConfig({
            ...production,
            ...productionMediaEnvironment,
            [name]: undefined,
          })
        );

        expect(Exit.isFailure(exit), `${name} should be required`).toBe(true);
      }
    })
  );

  it.effect("rejects the .env.example credential placeholders", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        loadServerConfig({
          ...production,
          ...productionMediaEnvironment,
          MEDIA_UPLOAD_ACCESS_KEY_ID: "feeblo",
          MEDIA_UPLOAD_SECRET_ACCESS_KEY: "password",
        })
      );

      expect(Exit.isFailure(exit)).toBe(true);
    })
  );

  it.effect("accepts any media base URL the operator supplies", () =>
    Effect.gen(function* () {
      // Only presence is enforced: a loopback host, an address literal, and a
      // relative path are all the operator's call. The fallback is what the
      // check exists to prevent, not a shape.
      for (const baseUrl of [
        "http://127.0.0.1:9002/feeblo-media-public",
        "http://10.1.2.3:9000",
        "/media",
      ]) {
        const exit = yield* Effect.exit(
          loadServerConfig({
            ...production,
            ...productionMediaEnvironment,
            MEDIA_PUBLIC_BASE_URL: baseUrl,
          })
        );

        expect(Exit.isSuccess(exit), `${baseUrl} should be accepted`).toBe(
          true
        );
      }
    })
  );

  it.effect("accepts the development fallback outside production", () =>
    Effect.gen(function* () {
      const config = yield* loadServerConfig({});

      expect(config.nodeEnv).toBe("development");
    })
  );
});

describe("ServerConfig E2E switches", () => {
  const production = {
    NODE_ENV: "production",
    REDIS_URL: "redis://redis:6379/0",
    ...productionMediaEnvironment,
  };

  it.effect("defaults both switches off", () =>
    Effect.gen(function* () {
      const config = yield* loadServerConfig({});

      expect(config.e2eRoutesEnabled).toBe(false);
      expect(config.e2eTestMailer).toBe(false);
    })
  );

  it.effect("refuses to start in production with either switch on", () =>
    Effect.gen(function* () {
      for (const environment of [
        { E2E_TEST_MAILER: "true" },
        { E2E_ROUTES_ENABLED: "true" },
      ]) {
        const exit = yield* Effect.exit(
          loadServerConfig({ ...production, ...environment })
        );

        expect(
          Exit.isFailure(exit),
          `${Object.keys(environment)[0]} should be refused`
        ).toBe(true);
      }
    })
  );
});
