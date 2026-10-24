import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const trailingSlashPattern = /\/$/;

/**
 * Where a deployment's own feedback widget files what it collects.
 *
 * `FEEDBACK_WIDGET_ORGANIZATION_ID` is the workspace the dashboard's "Send
 * Feedback" button submits to — Feeblo's own on feeblo.com. It is read here,
 * on the server, rather than taken from the request: a caller must never
 * choose the audience of the identity token it is handed, because that token
 * is then signed with that workspace's secret and attributes feedback inside
 * it. Unset means the widget is disabled for the deployment.
 *
 * `appUrl` is the token's `iss`. The widget stores it unverified today (see
 * `docs/widget-sso.md`), and minting it correctly now is what lets the claim
 * be promoted to required without a second token change.
 */
export class FeedbackWidgetConfig extends Context.Service<FeedbackWidgetConfig>()(
  "FeedbackWidgetConfig",
  {
    make: Effect.gen(function* () {
      const organizationId = yield* Config.String(
        "FEEDBACK_WIDGET_ORGANIZATION_ID"
      ).pipe(
        Config.option,
        Effect.map((value) =>
          Option.match(value, {
            // An empty or whitespace value is the same as unset: the widget
            // route 404s on a blank id, so there is nothing to enable.
            onNone: () => undefined,
            onSome: (candidate) => candidate.trim() || undefined,
          })
        )
      );
      const appUrl = yield* Config.schema(Schema.URLFromString, "APP_URL");

      return {
        appUrl: appUrl.href.replace(trailingSlashPattern, ""),
        organizationId,
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);

  /** Supplies an already-resolved configuration to tests. */
  static readonly layerTest = ({
    appUrl = "https://app.example.com",
    organizationId,
  }: {
    appUrl?: string | undefined;
    organizationId: string | undefined;
  }) => Layer.succeed(this, this.of({ appUrl, organizationId }));
}
