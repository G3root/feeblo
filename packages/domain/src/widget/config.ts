import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

const trailingSlashPattern = /\/$/;

/**
 * An optional environment value, with the blank case treated as absent: an
 * empty workspace id would 404 the widget route, and an empty key is not a key.
 */
const optionalText = (name: string) =>
  Config.String(name).pipe(
    Config.option,
    Effect.map((value) =>
      Option.match(value, {
        onNone: () => undefined,
        onSome: (candidate) => candidate.trim() || undefined,
      })
    )
  );

/**
 * Where a deployment's own support widget files what it collects, and what
 * signs the submitter's identity token.
 *
 * `FEEDBACK_WIDGET_ORGANIZATION_ID` is the workspace the dashboard's "Support"
 * button submits to — Feeblo's own on feeblo.com. It is read here, on the
 * server, rather than taken from the request: a caller must never choose the
 * audience of the identity token it is handed, because that token is then
 * signed with that workspace's secret and attributes feedback inside it. A
 * customer's own workspace is never the audience — a report about our product
 * must not land on their board. Unset means the widget is disabled.
 *
 * `FEEDBACK_WIDGET_SSO_SECRET` is the optional signing key. The widget verifies
 * with the audience workspace's secret in `jwt_secret` (rotatable in Settings
 * → Security), so a deployment that keeps its configuration in env sets the
 * same value here and never needs that page; when unset the API signs with the
 * workspace's active stored secret instead. A value that does not match the
 * stored one produces tokens the widget rejects, so the two are one credential
 * in two places — see `.env.example`.
 *
 * `appUrl` is the token's `iss`. The widget stores it unverified today (see
 * `docs/widget-sso.md`), and minting it correctly now is what lets the claim be
 * promoted to required without a second token change.
 */
export class FeedbackWidgetConfig extends Context.Service<FeedbackWidgetConfig>()(
  "FeedbackWidgetConfig",
  {
    make: Effect.gen(function* () {
      const organizationId = yield* optionalText(
        "FEEDBACK_WIDGET_ORGANIZATION_ID"
      );
      const ssoSecret = yield* Config.Redacted(
        "FEEDBACK_WIDGET_SSO_SECRET"
      ).pipe(
        Config.option,
        // Kept `Redacted` in the service so a logged config value cannot leak
        // the key that mints identities for the workspace.
        Effect.map((value) =>
          Option.match(value, {
            onNone: () => undefined,
            onSome: (candidate) =>
              Redacted.value(candidate).trim() === "" ? undefined : candidate,
          })
        )
      );
      const appUrl = yield* Config.schema(Schema.URLFromString, "APP_URL");

      return {
        appUrl: appUrl.href.replace(trailingSlashPattern, ""),
        organizationId,
        ssoSecret,
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);

  /** Supplies an already-resolved configuration to tests. */
  static readonly layerTest = ({
    appUrl = "https://app.example.com",
    organizationId,
    ssoSecret,
  }: {
    appUrl?: string | undefined;
    organizationId: string | undefined;
    ssoSecret?: string | undefined;
  }) =>
    Layer.succeed(
      this,
      this.of({
        appUrl,
        organizationId,
        ssoSecret:
          ssoSecret === undefined ? undefined : Redacted.make(ssoSecret),
      })
    );
}
