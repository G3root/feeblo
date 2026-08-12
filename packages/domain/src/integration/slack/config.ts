import { SLACK_OAUTH_SCOPES } from "@feeblo/integration-slack/manifest";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

const trailingSlashPattern = /\/$/;

/**
 * Runtime Slack integration configuration: app credentials, the request
 * signing secret, the OAuth redirect URL, and the at-rest encryption key
 * shared with the webhook provider.
 */
export class SlackIntegrationConfig extends Context.Service<SlackIntegrationConfig>()(
  "SlackIntegrationConfig",
  {
    make: Effect.gen(function* () {
      const appUrl = yield* Config.schema(Schema.URLFromString, "APP_URL");
      const apiUrl = yield* Config.schema(Schema.URLFromString, "API_URL");
      const clientId = yield* Config.string("SLACK_CLIENT_ID").pipe(
        Config.option
      );
      const clientSecret = yield* Config.redacted("SLACK_CLIENT_SECRET").pipe(
        Config.option
      );
      const signingSecret = yield* Config.redacted("SLACK_SIGNING_SECRET").pipe(
        Config.option
      );
      const oauthRedirectUrl = yield* Config.string(
        "SLACK_OAUTH_REDIRECT_URL"
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
        () => `${apiUrlValue}/slack/oauth/callback`
      );
      return {
        appUrl: appUrlValue,
        authorizeScopes: SLACK_OAUTH_SCOPES,
        clientId: Option.getOrElse(clientId, () => ""),
        clientSecret: Option.getOrElse(clientSecret, () => Redacted.make("")),
        encryptionKey,
        oauthRedirectUrl: configuredRedirectUrl,
        signingSecret: Option.getOrElse(signingSecret, () => Redacted.make("")),
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);

  /** Supplies a fixed configuration to tests. */
  static readonly layerTest = ({
    appUrl = "http://localhost:3001",
    clientId = "slack-client-id",
    clientSecret = Redacted.make("slack-client-secret"),
    encryptionKey = Redacted.make("0123456789abcdef0123456789abcdef"),
    oauthRedirectUrl = "http://localhost:3000/slack/oauth/callback",
    signingSecret = Redacted.make("slack-signing-secret"),
  }: {
    readonly appUrl?: string;
    readonly clientId?: string;
    readonly clientSecret?: Redacted.Redacted<string>;
    readonly encryptionKey?: Redacted.Redacted<string>;
    readonly oauthRedirectUrl?: string;
    readonly signingSecret?: Redacted.Redacted<string>;
  } = {}) =>
    Layer.succeed(
      this,
      this.of({
        appUrl,
        authorizeScopes: SLACK_OAUTH_SCOPES,
        clientId,
        clientSecret,
        encryptionKey,
        oauthRedirectUrl,
        signingSecret,
      })
    );
}
