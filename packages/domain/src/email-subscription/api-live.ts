import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import { EmailOutboxRepository } from "../email-outbox/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import { Api } from "../http/api";
import { BadRequestError, InternalServerError } from "../rpc-errors";
import { WorkspaceRepository } from "../workspace/repository";
import { EmailSubscriptionConsentHandlersEffect } from "./handlers";
import { EmailSubscriptionRepository } from "./repository";

const linkFailure = (
  operation: "unsubscribe" | "verify",
  error: { readonly _tag: string }
) =>
  error._tag === "EmailSubscriptionTokenError" ||
  error._tag === "EmailSubscriptionInputError"
    ? new BadRequestError({
        message: `Email subscription ${operation} link is invalid or expired`,
      })
    : new InternalServerError({
        message: `Email subscription ${operation} failed`,
      });

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
          Effect.mapError((error) => linkFailure("verify", error))
        )
      )
      .handle("unsubscribeEmailSubscription", ({ query }) =>
        EmailSubscriptionConsentHandlersEffect.pipe(
          Effect.flatMap((consent) =>
            consent.unsubscribe({ unsubscribeToken: query.token })
          ),
          Effect.mapError((error) => linkFailure("unsubscribe", error))
        )
      )
      .handle("unsubscribeEmailSubscriptionLink", ({ query }) =>
        EmailSubscriptionConsentHandlersEffect.pipe(
          Effect.flatMap((consent) =>
            consent.unsubscribe({ unsubscribeToken: query.token })
          ),
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
