import { parseClientIpProxyTrust } from "@feeblo/domain/client-ip";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

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
