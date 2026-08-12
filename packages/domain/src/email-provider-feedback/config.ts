import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

/** Authentication configuration for the provider lifecycle webhook. */
export class EmailProviderFeedbackConfig extends Context.Service<EmailProviderFeedbackConfig>()(
  "EmailProviderFeedbackConfig",
  {
    make: Effect.gen(function* () {
      return {
        // Required, independent of AUTH_ENCRYPTION_KEY: the provider delivery
        // secret must not be derivable from the at-rest auth encryption key.
        webhookToken: yield* Config.redacted("EMAIL_PROVIDER_WEBHOOK_TOKEN"),
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);

  /** Supplies a redacted provider webhook token to HTTP integration tests. */
  static readonly layerTest = (webhookToken: string) =>
    Layer.succeed(this, this.of({ webhookToken: Redacted.make(webhookToken) }));
}
