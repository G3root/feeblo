import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

/**
 * Configuration for the optional Amazon SES event feedback webhook. Self-hosted
 * deployments that do not use SES feedback can leave every value unset; the
 * webhook route then stays inert.
 */
export class EmailProviderFeedbackConfig extends Context.Service<EmailProviderFeedbackConfig>()(
  "EmailProviderFeedbackConfig",
  {
    make: Effect.gen(function* () {
      return {
        // Independent of AUTH_ENCRYPTION_KEY: the provider delivery secret must
        // not be derivable from the at-rest auth encryption key.
        webhookToken: yield* Config.redacted(
          "EMAIL_PROVIDER_WEBHOOK_TOKEN"
        ).pipe(Config.option),
        // When configured, only SNS messages from this topic are accepted.
        // Configure it alongside the token to reject cross-topic deliveries.
        expectedTopicArn: yield* Config.string(
          "EMAIL_PROVIDER_SNS_TOPIC_ARN"
        ).pipe(Config.option),
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);

  /** Supplies configured webhook values to webhook integration tests. */
  static readonly layerTest = (
    webhookToken: string,
    expectedTopicArn: string
  ) =>
    Layer.succeed(
      this,
      this.of({
        webhookToken: Option.some(Redacted.make(webhookToken)),
        expectedTopicArn: Option.some(expectedTopicArn),
      })
    );
}
