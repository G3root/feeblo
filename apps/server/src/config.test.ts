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
  AUTH_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
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

describe("ServerConfig GitHub App public URLs", () => {
  it.effect(
    "derives GitHub App callback and global webhook URLs from API_URL",
    () =>
      Effect.gen(function* () {
        const config = yield* loadServerConfig();
        expect(config.githubOAuthCallbackUrl).toBe(
          "https://api.example.test/github/app/installations/callback"
        );
        expect(config.githubWebhookUrl).toBe(
          "https://api.example.test/github/app/webhooks"
        );
      })
  );

  it.effect("accepts explicit public GitHub App URLs", () =>
    Effect.gen(function* () {
      const config = yield* loadServerConfig({
        GITHUB_INTEGRATION_APP_INSTALLATION_CALLBACK_URL:
          "https://public.example.test/github/app/installations/callback",
        GITHUB_INTEGRATION_APP_WEBHOOK_URL:
          "https://public.example.test/github/webhook",
      });
      expect(config.githubOAuthCallbackUrl).toBe(
        "https://public.example.test/github/app/installations/callback"
      );
      expect(config.githubWebhookUrl).toBe(
        "https://public.example.test/github/webhook"
      );
    })
  );
});
