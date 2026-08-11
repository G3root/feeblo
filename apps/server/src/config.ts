import { parseClientIpProxyTrust } from "@feeblo/domain/client-ip";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export class ServerConfig extends Context.Service<ServerConfig>()(
  "ServerConfig",
  {
    make: Effect.gen(function* () {
      const appUrl = yield* Config.string("APP_URL");
      const apiUrl = yield* Config.string("API_URL");
      const appRootDomain = yield* Config.string("APP_ROOT_DOMAIN");
      const nodeEnv = yield* Config.string("NODE_ENV").pipe(
        Config.withDefault("development")
      );
      // INTEGRATION_ENCRYPTION_KEY defaults to AUTH_ENCRYPTION_KEY when unset,
      // so deployments can share a single required secret for both.
      const integrationEncryptionKey = yield* Config.redacted(
        "INTEGRATION_ENCRYPTION_KEY"
      ).pipe(
        Config.option,
        Effect.flatMap(
          Option.match({
            onNone: () => Config.redacted("AUTH_ENCRYPTION_KEY"),
            onSome: (key) => Effect.succeed(key),
          })
        )
      );
      const integrationAllowPrivateNetwork = yield* Config.boolean(
        "INTEGRATION_ALLOW_PRIVATE_NETWORK"
      ).pipe(Config.withDefault(false));
      const integrationConnectionConcurrency = yield* Config.schema(
        Schema.Int.check(Schema.isGreaterThan(0)),
        "INTEGRATION_CONNECTION_CONCURRENCY"
      ).pipe(Config.withDefault(5));
      const integrationGlobalConcurrency = yield* Config.schema(
        Schema.Int.check(Schema.isGreaterThan(0)),
        "INTEGRATION_GLOBAL_CONCURRENCY"
      ).pipe(Config.withDefault(25));
      const redisUrl = yield* Config.string("REDIS_URL").pipe(
        Config.option,
        Effect.map(Option.getOrUndefined)
      );
      const sentryEnvironment = yield* Config.string("SENTRY_ENVIRONMENT").pipe(
        Config.withDefault(nodeEnv)
      );
      const sentryDsn = yield* Config.string("SENTRY_DSN").pipe(
        Config.option,
        Effect.map(Option.getOrUndefined)
      );
      const sentryTracesSampleRate = yield* Config.number(
        "SENTRY_TRACES_SAMPLE_RATE"
      ).pipe(Config.withDefault(0.1));
      const trustAllProxyHeaders = yield* Config.boolean(
        "TRUST_PROXY_HEADERS"
      ).pipe(Config.withDefault(false));
      const trustedProxyIps = yield* Config.string("TRUSTED_PROXY_IPS").pipe(
        Config.option,
        Effect.map(
          Option.match({
            onNone: () => [],
            onSome: (value) =>
              value
                .split(",")
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0),
          })
        )
      );
      const clientIpProxyTrust = yield* Effect.fromResult(
        parseClientIpProxyTrust({
          trustAllHeaders: trustAllProxyHeaders,
          trustedProxyCidrs: trustedProxyIps,
        })
      );

      return {
        apiUrl,
        appUrl,
        appRootDomain,
        clientIpProxyTrust,
        integrationAllowPrivateNetwork:
          nodeEnv === "development" && integrationAllowPrivateNetwork,
        integrationConnectionConcurrency,
        integrationEncryptionKey,
        integrationGlobalConcurrency,
        nodeEnv,
        redisUrl,
        sentryDsn,
        sentryEnvironment,
        sentryTracesSampleRate,
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
