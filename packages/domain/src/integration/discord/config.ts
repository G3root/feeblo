import {
  DISCORD_OAUTH_PERMISSIONS,
  DISCORD_OAUTH_SCOPES,
} from "@feeblo/integration-discord/manifest";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

const trailingSlashPattern = /\/$/;

/**
 * Runtime Discord integration configuration: the application credentials,
 * the application-wide bot token, the interaction public key, the OAuth
 * redirect URL, and the at-rest encryption key shared with the webhook
 * provider.
 *
 * The bot token and public key are application-wide (one bot serves every
 * guild install), so they live in configuration — exactly like the Slack
 * signing secret — instead of in per-connection encrypted credentials.
 */
export class DiscordIntegrationConfig extends Context.Service<DiscordIntegrationConfig>()(
  "DiscordIntegrationConfig",
  {
    make: Effect.gen(function* () {
      const appUrl = yield* Config.schema(Schema.URLFromString, "APP_URL");
      const apiUrl = yield* Config.schema(Schema.URLFromString, "API_URL");
      const clientId = yield* Config.string("DISCORD_CLIENT_ID").pipe(
        Config.option
      );
      const clientSecret = yield* Config.redacted("DISCORD_CLIENT_SECRET").pipe(
        Config.option
      );
      const botToken = yield* Config.redacted("DISCORD_BOT_TOKEN").pipe(
        Config.option
      );
      const publicKey = yield* Config.string("DISCORD_PUBLIC_KEY").pipe(
        Config.option
      );
      const oauthRedirectUrl = yield* Config.string(
        "DISCORD_OAUTH_REDIRECT_URL"
      ).pipe(Config.option);
      // INTEGRATION_ENCRYPTION_KEY defaults to AUTH_ENCRYPTION_KEY when unset,
      // so deployments can share a single required secret for both.
      const encryptionKey = yield* Config.redacted(
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
      const apiUrlValue = apiUrl.href.replace(trailingSlashPattern, "");
      const appUrlValue = appUrl.href.replace(trailingSlashPattern, "");
      const configuredRedirectUrl = Option.getOrElse(
        oauthRedirectUrl,
        () => `${apiUrlValue}/discord/oauth/callback`
      );
      const configuredClientId = Option.getOrElse(clientId, () => "");
      const configuredClientSecret = Option.getOrElse(clientSecret, () =>
        Redacted.make("")
      );
      const configuredBotToken = Option.getOrElse(botToken, () =>
        Redacted.make("")
      );
      const configuredPublicKey = Option.getOrElse(publicKey, () => "");
      return {
        appUrl: appUrlValue,
        authorizeScopes: DISCORD_OAUTH_SCOPES,
        botToken: configuredBotToken,
        clientId: configuredClientId,
        clientSecret: configuredClientSecret,
        // The provider is only exposed when the OAuth client id, client
        // secret, bot token, and interaction public key are all configured;
        // otherwise the server runs without the Discord integration.
        configured:
          configuredClientId !== "" &&
          Redacted.value(configuredClientSecret) !== "" &&
          Redacted.value(configuredBotToken) !== "" &&
          configuredPublicKey !== "",
        encryptionKey,
        oauthRedirectUrl: configuredRedirectUrl,
        permissions: DISCORD_OAUTH_PERMISSIONS,
        publicKey: configuredPublicKey,
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);

  /** Supplies a fixed configuration to tests. */
  static readonly layerTest = ({
    appUrl = "http://localhost:3001",
    botToken = Redacted.make("discord-bot-token"),
    clientId = "discord-client-id",
    clientSecret = Redacted.make("discord-client-secret"),
    configured = true,
    encryptionKey = Redacted.make("0123456789abcdef0123456789abcdef"),
    oauthRedirectUrl = "http://localhost:3000/discord/oauth/callback",
    publicKey = "0".repeat(64),
  }: {
    readonly appUrl?: string;
    readonly botToken?: Redacted.Redacted<string>;
    readonly clientId?: string;
    readonly clientSecret?: Redacted.Redacted<string>;
    readonly configured?: boolean;
    readonly encryptionKey?: Redacted.Redacted<string>;
    readonly oauthRedirectUrl?: string;
    readonly publicKey?: string;
  } = {}) =>
    Layer.succeed(
      this,
      this.of({
        appUrl,
        authorizeScopes: DISCORD_OAUTH_SCOPES,
        botToken,
        clientId,
        clientSecret,
        configured,
        encryptionKey,
        oauthRedirectUrl,
        permissions: DISCORD_OAUTH_PERMISSIONS,
        publicKey,
      })
    );
}
