import { timingSafeEqual } from "node:crypto";

import { ClientIp } from "@feeblo/domain/client-ip";
import { EmailProviderFeedbackConfig } from "@feeblo/domain/email-provider-feedback/config";
import { SesEmailFeedbackWebhook } from "@feeblo/domain/email-provider-feedback/ses-webhook";
import { RateLimitService } from "@feeblo/domain/rate-limit/service";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

/** Per-client bound for the unauthenticated SES feedback ingress. */
const SES_FEEDBACK_RATE_LIMIT = {
  keyPrefix: "ses-email-feedback",
  limit: 60,
  window: "1 minute",
} as const;

const WEBHOOK_TOKEN_HEADER = "x-feeblo-webhook-token";

const headerToken = (
  request: HttpServerRequest.HttpServerRequest
): string | undefined =>
  Option.getOrUndefined(Headers.get(request.headers, WEBHOOK_TOKEN_HEADER));

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

const handleSesFeedback = (
  request: HttpServerRequest.HttpServerRequest,
  suppliedToken: string
) =>
  Effect.gen(function* () {
    const config = yield* EmailProviderFeedbackConfig;
    const configuredToken = config.webhookToken;
    if (Option.isNone(configuredToken)) {
      // Feature not configured: stay inert for self-hosted deployments.
      return HttpServerResponse.text("not found", { status: 404 });
    }

    // Bound unauthenticated traffic before any token comparison or envelope
    // work. The limiter fails open on store outages so a Redis problem cannot
    // drop SES feedback deliveries.
    const clientIp = yield* ClientIp;
    if (clientIp._tag === "ClientIpAddress") {
      const rateLimitService = yield* RateLimitService;
      const exceeded = yield* rateLimitService
        .consume({
          key: `${SES_FEEDBACK_RATE_LIMIT.keyPrefix}:${clientIp.address}`,
          limit: SES_FEEDBACK_RATE_LIMIT.limit,
          window: SES_FEEDBACK_RATE_LIMIT.window,
        })
        .pipe(
          Effect.as(false),
          Effect.catchTag("RateLimiterError", (error) =>
            error.reason._tag === "RateLimitExceeded"
              ? Effect.succeed(true)
              : Effect.logWarning(
                  "SES email feedback rate limiter unavailable"
                ).pipe(Effect.as(false))
          )
        );
      if (exceeded) {
        return HttpServerResponse.text("Too many requests", { status: 429 });
      }
    }

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
        outcome satisfies never;
        return HttpServerResponse.text("unexpected SES webhook outcome", {
          status: 500,
        });
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
  );

/**
 * Amazon SES event feedback ingress.
 *
 * SNS HTTPS subscriptions cannot send request headers, so the canonical route
 * carries the webhook token in the URL path
 * (`/email-provider/ses/:token`). A header-only form
 * (`x-feeblo-webhook-token`) is also accepted for callers that can set
 * headers, so the token does not have to be written to access logs.
 *
 * The token is only the first gate: the SNS envelope signature and signed
 * TopicArn are verified by {@link SesEmailFeedbackWebhook} before any event is
 * ingested.
 */
export const makeSesEmailFeedbackRouter = () =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      yield* router.add(
        "POST",
        "/email-provider/ses/:token",
        (request: HttpServerRequest.HttpServerRequest) =>
          Effect.gen(function* () {
            const params = yield* HttpRouter.params;
            const token = params.token ?? headerToken(request) ?? "";
            return yield* handleSesFeedback(request, token);
          })
      );
      yield* router.add(
        "POST",
        "/email-provider/ses",
        (request: HttpServerRequest.HttpServerRequest) =>
          handleSesFeedback(request, headerToken(request) ?? "")
      );
    })
  ).pipe(Layer.orDie);
