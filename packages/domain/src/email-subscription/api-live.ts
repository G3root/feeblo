import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import { EmailOutboxRepository } from "../email-outbox/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import { Api } from "../http/api";
import * as RateLimit from "../rate-limit";
import { BadRequestError, InternalServerError } from "../rpc-errors";
import { WorkspaceRepository } from "../workspace/repository";
import { EmailSubscriptionConsentHandlersEffect } from "./handlers";
import { EmailSubscriptionRepository } from "./repository";

type LinkFailureError =
  | BadRequestError
  | InternalServerError
  | RateLimit.RateLimitExceededError
  | RateLimit.RateLimitUnavailableError;

const linkFailure = (
  operation: "unsubscribe" | "verify",
  error: { readonly _tag: string }
): LinkFailureError => {
  switch (error._tag) {
    // Rate-limit failures pass through unchanged so clients get 429/503.
    case "RateLimitExceededError":
      return error as RateLimit.RateLimitExceededError;
    case "RateLimitUnavailableError":
      return error as RateLimit.RateLimitUnavailableError;
    case "EmailSubscriptionTokenError":
    case "EmailSubscriptionInputError":
      return new BadRequestError({
        message: `Email subscription ${operation} link is invalid or expired`,
      });
    default:
      return new InternalServerError({
        message: `Email subscription ${operation} failed`,
      });
  }
};

/** Implements public verification and RFC 8058 one-click unsubscribe links. */
export const EmailSubscriptionApiLive = HttpApiBuilder.group(
  Api,
  "EmailSubscriptionApiGroup",
  (handlers) =>
    handlers
      .handle("verifyEmailSubscription", ({ query }) =>
        EmailSubscriptionConsentHandlersEffect.pipe(
          Effect.flatMap((consent) =>
            consent.verifySubscription({ verificationToken: query.token })
          ),
          RateLimit.withPublicHttpRateLimit({
            name: "EmailSubscriptionVerify",
            level: "read",
          }),
          Effect.mapError((error) => linkFailure("verify", error))
        )
      )
      .handle("unsubscribeEmailSubscription", ({ query }) =>
        EmailSubscriptionConsentHandlersEffect.pipe(
          Effect.flatMap((consent) =>
            consent.unsubscribe({ unsubscribeToken: query.token })
          ),
          RateLimit.withPublicHttpRateLimit({
            name: "EmailSubscriptionUnsubscribe",
            level: "read",
          }),
          Effect.mapError((error) => linkFailure("unsubscribe", error))
        )
      )
      .handle("unsubscribeEmailSubscriptionLink", ({ query }) =>
        EmailSubscriptionConsentHandlersEffect.pipe(
          Effect.flatMap((consent) =>
            consent.unsubscribe({ unsubscribeToken: query.token })
          ),
          RateLimit.withPublicHttpRateLimit({
            name: "EmailSubscriptionUnsubscribeLink",
            level: "read",
          }),
          Effect.mapError((error) => linkFailure("unsubscribe", error))
        )
      )
).pipe(
  Layer.provide(EmailOutboxRepository.layer),
  Layer.provide(EmailSubscriptionRepository.layer),
  Layer.provide(
    EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer))
  )
);
