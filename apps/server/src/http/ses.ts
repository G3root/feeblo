import { timingSafeEqual } from "node:crypto";

import { EmailProviderFeedbackConfig } from "@feeblo/domain/email-provider-feedback/config";
import { SesEmailFeedbackWebhook } from "@feeblo/domain/email-provider-feedback/ses-webhook";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

const matchesWebhookToken = (
  suppliedToken: string,
  configuredToken: Redacted.Redacted<string>
): boolean => {
  const supplied = Buffer.from(suppliedToken);
  const configured = Buffer.from(Redacted.value(configuredToken));
  return (
    supplied.length === configured.length &&
    timingSafeEqual(supplied, configured)
  );
};

/**
 * Amazon SES event feedback ingress. The SNS topic is subscribed to this
 * endpoint with the provider webhook token embedded in the URL path, because
 * SNS HTTPS subscriptions cannot send request headers.
 */
export const makeSesEmailFeedbackRouter = () =>
  HttpRouter.use((router) =>
    router.add("POST", "/email-provider/ses/:token", (request) =>
      Effect.gen(function* () {
        const params = yield* HttpRouter.params;
        const config = yield* EmailProviderFeedbackConfig;
        const configuredToken = config.webhookToken;
        if (Option.isNone(configuredToken)) {
          // Feature not configured: stay inert for self-hosted deployments.
          return HttpServerResponse.text("not found", { status: 404 });
        }
        const suppliedToken = params.token ?? "";
        if (!matchesWebhookToken(suppliedToken, configuredToken.value)) {
          return HttpServerResponse.text("unauthorized", { status: 401 });
        }

        const webhook = yield* SesEmailFeedbackWebhook;
        const rawBody = yield* request.text;
        const outcome = yield* webhook.handle(rawBody);

        switch (outcome._tag) {
          case "Confirmed":
            return HttpServerResponse.text("subscription confirmed", {
              status: 200,
            });
          case "Ignored":
            return HttpServerResponse.text("ignored", { status: 200 });
          case "Ingested":
            return HttpServerResponse.jsonUnsafe({
              result: outcome.result._tag,
            });
          default:
            return outcome satisfies never;
        }
      }).pipe(
        Effect.catchTags({
          SesWebhookEnvelopeError: () =>
            Effect.succeed(
              HttpServerResponse.text("invalid SNS envelope", {
                status: 400,
              })
            ),
          SesWebhookConfirmationError: () =>
            Effect.succeed(
              HttpServerResponse.text("subscription confirmation failed", {
                status: 500,
              })
            ),
          EmailProviderFeedbackInputError: () =>
            Effect.succeed(
              HttpServerResponse.text("invalid provider event", {
                status: 400,
              })
            ),
          EmailProviderFeedbackDataError: () =>
            Effect.succeed(
              HttpServerResponse.text("provider feedback persistence failed", {
                status: 500,
              })
            ),
        }),
        Effect.catch((cause) =>
          Effect.logError(cause).pipe(
            Effect.as(
              HttpServerResponse.text(
                "SES email feedback webhook processing failed",
                { status: 500 }
              )
            )
          )
        )
      )
    )
  ).pipe(Layer.orDie);
