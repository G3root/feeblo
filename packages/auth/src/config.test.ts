import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

import { AuthConfig } from "./config";

const requiredAuthEnvironment = {
  APP_ROOT_DOMAIN: "example.test",
  APP_URL: "https://example.test",
  API_URL: "https://api.example.test",
  AUTH_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
};

const loadAuthConfig = (environment: Record<string, string | undefined> = {}) =>
  AuthConfig.pipe(
    Effect.provide(
      AuthConfig.layer.pipe(
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              ...requiredAuthEnvironment,
              ...environment,
            })
          )
        )
      )
    )
  );

describe("AuthConfig encryption key", () => {
  it.effect("accepts a short key outside production", () =>
    Effect.gen(function* () {
      const config = yield* loadAuthConfig({ AUTH_ENCRYPTION_KEY: "secret" });

      expect(config.nodeEnv).toBe("development");
    })
  );

  it.effect("rejects a short key in production", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        loadAuthConfig({
          AUTH_ENCRYPTION_KEY: "secret",
          NODE_ENV: "production",
        })
      );

      expect(Exit.isFailure(exit)).toBe(true);
    })
  );

  it.effect("accepts a 32-byte key in production", () =>
    Effect.gen(function* () {
      const config = yield* loadAuthConfig({ NODE_ENV: "production" });

      expect(config.nodeEnv).toBe("production");
    })
  );
});
