import { parseClientIpProxyTrust } from "@feeblo/domain/client-ip";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

export class ServerConfig extends Context.Service<ServerConfig>()(
  "ServerConfig",
  {
    make: Effect.gen(function* () {
      const appUrl = yield* Config.String("APP_URL");
      const apiUrl = yield* Config.String("API_URL");
      const appRootDomain = yield* Config.String("APP_ROOT_DOMAIN");
      const nodeEnv = yield* Config.String("NODE_ENV").pipe(
        Config.withDefault("development")
      );
      const githubAppId = yield* Config.String(
        "GITHUB_INTEGRATION_APP_ID"
      ).pipe(Config.option, Effect.map(Option.getOrUndefined));
      const githubAppSlug = yield* Config.String(
        "GITHUB_INTEGRATION_APP_SLUG"
      ).pipe(Config.option, Effect.map(Option.getOrUndefined));
      const githubClientId = yield* Config.String(
        "GITHUB_INTEGRATION_CLIENT_ID"
      ).pipe(Config.option, Effect.map(Option.getOrUndefined));
      const githubClientSecret = yield* Config.Redacted(
        "GITHUB_INTEGRATION_CLIENT_SECRET"
      ).pipe(
        Config.option,
        Effect.map((value) => Option.getOrElse(value, () => Redacted.make("")))
      );
      const githubWebhookSecret = yield* Config.Redacted(
        "GITHUB_INTEGRATION_WEBHOOK_SECRET"
      ).pipe(
        Config.option,
        Effect.map((value) => Option.getOrElse(value, () => Redacted.make("")))
      );
      const githubPrivateKey = yield* Config.Redacted(
        "GITHUB_INTEGRATION_PRIVATE_KEY"
      ).pipe(
        Config.option,
        Effect.map((value) => Option.getOrElse(value, () => Redacted.make("")))
      );
      const integrationEncryptionKey = yield* Config.Redacted(
        "INTEGRATION_ENCRYPTION_KEY"
      ).pipe(
        Config.option,
        Effect.flatMap(
          Option.match({
            onNone: () => Config.Redacted("AUTH_ENCRYPTION_KEY"),
            onSome: Effect.succeed,
          })
        )
      );
      // Slack App credentials are optional; the integration only registers
      // when the client id, client secret, and signing secret are all set.
      const slackClientId = yield* Config.String("SLACK_CLIENT_ID").pipe(
        Config.option,
        Effect.map(Option.getOrUndefined)
      );
      const slackClientSecret = yield* Config.Redacted(
        "SLACK_CLIENT_SECRET"
      ).pipe(
        Config.option,
        Effect.map((value) => Option.getOrElse(value, () => Redacted.make("")))
      );
      const slackSigningSecret = yield* Config.Redacted(
        "SLACK_SIGNING_SECRET"
      ).pipe(
        Config.option,
        Effect.map((value) => Option.getOrElse(value, () => Redacted.make("")))
      );
      const slackOauthRedirectUrl = yield* Config.String(
        "SLACK_OAUTH_REDIRECT_URL"
      ).pipe(Config.option, Effect.map(Option.getOrUndefined));
      // Discord App credentials are optional; the integration only registers
      // when the client id, client secret, bot token, and public key are set.
      const discordClientId = yield* Config.String("DISCORD_CLIENT_ID").pipe(
        Config.option,
        Effect.map(Option.getOrUndefined)
      );
      const discordClientSecret = yield* Config.Redacted(
        "DISCORD_CLIENT_SECRET"
      ).pipe(
        Config.option,
        Effect.map((value) => Option.getOrElse(value, () => Redacted.make("")))
      );
      const discordBotToken = yield* Config.Redacted("DISCORD_BOT_TOKEN").pipe(
        Config.option,
        Effect.map((value) => Option.getOrElse(value, () => Redacted.make("")))
      );
      const discordPublicKey = yield* Config.String("DISCORD_PUBLIC_KEY").pipe(
        Config.option,
        Effect.map(Option.getOrUndefined)
      );
      const discordOauthRedirectUrl = yield* Config.String(
        "DISCORD_OAUTH_REDIRECT_URL"
      ).pipe(Config.option, Effect.map(Option.getOrUndefined));
      // Outbound-webhook egress policy override: private-network receivers
      // are honored in development only (see makeWebhookIntegrationConfig).
      const integrationAllowPrivateNetwork = yield* Config.Boolean(
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
      const redisUrl = yield* Config.String("REDIS_URL").pipe(
        Config.option,
        Effect.map(Option.getOrUndefined)
      );
      const sentryEnvironment = yield* Config.String("SENTRY_ENVIRONMENT").pipe(
        Config.withDefault(nodeEnv)
      );
      const sentryDsn = yield* Config.String("SENTRY_DSN").pipe(
        Config.option,
        Effect.map(Option.getOrUndefined)
      );
      const sentryTracesSampleRate = yield* Config.Number(
        "SENTRY_TRACES_SAMPLE_RATE"
      ).pipe(Config.withDefault(0.1));
      const trustAllProxyHeaders = yield* Config.Boolean(
        "TRUST_PROXY_HEADERS"
      ).pipe(Config.withDefault(false));
      const trustedProxyIps = yield* Config.String("TRUSTED_PROXY_IPS").pipe(
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
        githubAppId,
        githubAppSlug,
        githubClientId,
        githubClientSecret,
        integrationEncryptionKey,
        integrationAllowPrivateNetwork,
        githubPrivateKey,
        githubWebhookSecret,
        integrationConnectionConcurrency,
        integrationGlobalConcurrency,
        nodeEnv,
        redisUrl,
        sentryDsn,
        sentryEnvironment,
        sentryTracesSampleRate,
        discordBotToken,
        discordClientId,
        discordClientSecret,
        discordOauthRedirectUrl,
        discordPublicKey,
        slackClientId,
        slackClientSecret,
        slackOauthRedirectUrl,
        slackSigningSecret,
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}

export type ServerConfigValue = Effect.Success<typeof ServerConfig.make>;
