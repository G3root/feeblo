import { parseClientIpProxyTrust } from "@feeblo/domain/client-ip";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
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
      // Shared rate-limit store is mandatory in production: an in-memory
      // fallback silently gives every replica its own buckets, so an attacker
      // can multiply a public rate limit by the instance count.
      if (nodeEnv === "production" && redisUrl === undefined) {
        return yield* Effect.fail(
          new Config.ConfigError(
            new ConfigProvider.SourceError({
              message:
                "REDIS_URL is required in production so rate limits are shared across instances. Set REDIS_URL.",
            })
          )
        );
      }
      const mediaUploadRegion = yield* Config.String(
        "MEDIA_UPLOAD_REGION"
      ).pipe(Config.option, Effect.map(Option.getOrUndefined));
      const mediaUploadEndpoint = yield* Config.String(
        "MEDIA_UPLOAD_ENDPOINT"
      ).pipe(Config.option, Effect.map(Option.getOrUndefined));
      const mediaUploadAccessKeyId = yield* Config.String(
        "MEDIA_UPLOAD_ACCESS_KEY_ID"
      ).pipe(Config.option, Effect.map(Option.getOrUndefined));
      const mediaUploadSecretAccessKey = yield* Config.String(
        "MEDIA_UPLOAD_SECRET_ACCESS_KEY"
      ).pipe(Config.option, Effect.map(Option.getOrUndefined));
      const mediaPublicBucketName = yield* Config.String(
        "MEDIA_PUBLIC_BUCKET_NAME"
      ).pipe(Config.option, Effect.map(Option.getOrUndefined));
      const mediaPublicBaseUrl = yield* Config.String(
        "MEDIA_PUBLIC_BASE_URL"
      ).pipe(Config.option, Effect.map(Option.getOrUndefined));
      // Media upload storage is mandatory in production, and mandatory here
      // rather than in the S3 service because the service is built per request:
      // a missing value does not fail startup, it fails the first editor
      // upload — or, for a missing public base URL, succeeds while handing
      // every client a URL on the authenticated S3 endpoint. The value's shape
      // is the operator's call: see docs/r2-production-checklist.md.
      if (nodeEnv === "production") {
        const mediaVariables = [
          ["MEDIA_UPLOAD_REGION", mediaUploadRegion],
          ["MEDIA_UPLOAD_ENDPOINT", mediaUploadEndpoint],
          ["MEDIA_UPLOAD_ACCESS_KEY_ID", mediaUploadAccessKeyId],
          ["MEDIA_UPLOAD_SECRET_ACCESS_KEY", mediaUploadSecretAccessKey],
          ["MEDIA_PUBLIC_BUCKET_NAME", mediaPublicBucketName],
          ["MEDIA_PUBLIC_BASE_URL", mediaPublicBaseUrl],
        ] as const;
        const missingMediaVariables = mediaVariables
          .filter(([, value]) => value === undefined)
          .map(([name]) => name);

        if (missingMediaVariables.length > 0) {
          return yield* Effect.fail(
            new Config.ConfigError(
              new ConfigProvider.SourceError({
                message: `Media upload storage is required in production. Set ${missingMediaVariables.join(", ")}. See docs/r2-production-checklist.md.`,
              })
            )
          );
        }
        // The `.env.example` values are development-only: the dev stack's
        // MinIO uses this pair, and a production bucket must not.
        if (
          mediaUploadAccessKeyId === "feeblo" &&
          mediaUploadSecretAccessKey === "password"
        ) {
          return yield* Effect.fail(
            new Config.ConfigError(
              new ConfigProvider.SourceError({
                message:
                  "MEDIA_UPLOAD_ACCESS_KEY_ID and MEDIA_UPLOAD_SECRET_ACCESS_KEY still hold the .env.example development placeholders. Issue a bucket-scoped access key pair for production.",
              })
            )
          );
        }
      }
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
      // Browser origins the operator explicitly trusts (better-auth
      // `trustedOrigins`). Also honored by the API CORS and CSRF origin
      // checks so a custom sign-in origin is not accepted by better-auth but
      // rejected by the API.
      const authTrustedOrigins = yield* Config.String(
        "AUTH_TRUSTED_ORIGINS"
      ).pipe(
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
        authTrustedOrigins,
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
