import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

/** Authentication configuration for the provider lifecycle webhook. */
export class EmailProviderFeedbackConfig extends Context.Service<EmailProviderFeedbackConfig>()(
  "EmailProviderFeedbackConfig",
  {
    make: Effect.gen(function* () {
      return {
        // Defaults to AUTH_ENCRYPTION_KEY when unset, so deployments can
        // share a single required secret for both.
        webhookToken: yield* Config.redacted(
          "EMAIL_PROVIDER_WEBHOOK_TOKEN"
        ).pipe(
          Config.option,
          Effect.flatMap(
            Option.match({
              onNone: () => Config.redacted("AUTH_ENCRYPTION_KEY"),
              onSome: (token) => Effect.succeed(token),
            })
          )
        ),
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);

  /** Supplies a redacted provider webhook token to HTTP integration tests. */
  static readonly layerTest = (webhookToken: string) =>
    Layer.succeed(this, this.of({ webhookToken: Redacted.make(webhookToken) }));
}
