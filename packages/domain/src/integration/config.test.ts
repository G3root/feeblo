import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import { WebhookIntegrationConfig } from "./config";

const requiredEnvironment = {
  APP_URL: "https://example.test",
  AUTH_ENCRYPTION_KEY: "test-encryption-key",
  NODE_ENV: "test",
};

const loadWebhookConfig = (
  environment: Record<string, string | undefined> = {}
) =>
  WebhookIntegrationConfig.pipe(
    Effect.provide(
      WebhookIntegrationConfig.layer.pipe(
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              ...requiredEnvironment,
              ...environment,
            })
          )
        )
      )
    )
  );

describe("WebhookIntegrationConfig encryption key", () => {
  it.effect(
    "falls back to AUTH_ENCRYPTION_KEY when INTEGRATION_ENCRYPTION_KEY is unset",
    () =>
      Effect.gen(function* () {
        const config = yield* loadWebhookConfig({
          INTEGRATION_ENCRYPTION_KEY: undefined,
          AUTH_ENCRYPTION_KEY: "auth-encryption-fallback",
        });

        expect(Redacted.value(config.encryptionKey)).toBe(
          "auth-encryption-fallback"
        );
      })
  );

  it.effect("prefers INTEGRATION_ENCRYPTION_KEY over AUTH_ENCRYPTION_KEY", () =>
    Effect.gen(function* () {
      const config = yield* loadWebhookConfig({
        INTEGRATION_ENCRYPTION_KEY: "integration-specific-key",
        AUTH_ENCRYPTION_KEY: "auth-encryption-fallback",
      });

      expect(Redacted.value(config.encryptionKey)).toBe(
        "integration-specific-key"
      );
    })
  );

  it.effect(
    "fails startup when neither INTEGRATION_ENCRYPTION_KEY nor AUTH_ENCRYPTION_KEY is set",
    () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          loadWebhookConfig({
            INTEGRATION_ENCRYPTION_KEY: undefined,
            AUTH_ENCRYPTION_KEY: undefined,
          })
        );

        expect(Exit.isFailure(exit)).toBe(true);
      })
  );
});

describe("WebhookIntegrationConfig endpoint security policy", () => {
  it.effect("derives a test environment from NODE_ENV=test", () =>
    Effect.gen(function* () {
      const config = yield* loadWebhookConfig({
        INTEGRATION_ALLOW_PRIVATE_NETWORK: "true",
      });

      expect(config.endpointSecurityPolicy).toEqual({
        allowPrivateNetworkInDevelopment: false,
        environment: "test",
      });
    })
  );

  it.effect("honors the private-network override only in development", () =>
    Effect.gen(function* () {
      const development = yield* loadWebhookConfig({
        INTEGRATION_ALLOW_PRIVATE_NETWORK: "true",
        NODE_ENV: "development",
      });
      expect(
        development.endpointSecurityPolicy.allowPrivateNetworkInDevelopment
      ).toBe(true);
      expect(development.endpointSecurityPolicy.environment).toBe(
        "development"
      );

      const production = yield* loadWebhookConfig({
        INTEGRATION_ALLOW_PRIVATE_NETWORK: "true",
        NODE_ENV: "production",
      });
      expect(
        production.endpointSecurityPolicy.allowPrivateNetworkInDevelopment
      ).toBe(false);
      expect(production.endpointSecurityPolicy.environment).toBe("production");
    })
  );
});
