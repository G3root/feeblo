import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import {
  RateLimitExceededError,
  RateLimitUnavailableError,
} from "../rate-limit";
import { RateLimitService } from "../rate-limit/service";
import { InternalServerError, withRemapDbErrors } from "../rpc-errors";
import { WorkspaceRepository } from "../workspace/repository";
import { EmailSubscriptionRepository } from "./repository";
import { EmailSubscriptionRpcs } from "./rpcs";
import {
  type EmailSubscriptionDataError,
  type EmailSubscriptionInputError,
  normalizeEmailAddress,
} from "./schema";
import type { EmailSubscriptionTokenError } from "./tokens";

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const EMAIL_SUBSCRIPTION_VERIFICATION_WINDOW = "24 hours";

const verificationExpiration = (now: Date): Date =>
  new Date(now.getTime() + VERIFICATION_TOKEN_TTL_MS);

export const EmailSubscriptionConsentHandlersEffect = Effect.gen(function* () {
  const entitlementPolicy = yield* EntitlementPolicy;
  const rateLimitService = yield* RateLimitService;
  const repository = yield* EmailSubscriptionRepository;

  const consumeVerificationRequest = (args: {
    readonly email: string;
    readonly organizationId: string;
  }) =>
    rateLimitService
      .consume({
        key: `email-subscription:verification-request:${args.organizationId}:${args.email}`,
        limit: 3,
        window: EMAIL_SUBSCRIPTION_VERIFICATION_WINDOW,
      })
      .pipe(
        Effect.catchTag("RateLimiterError", (error) =>
          Effect.fail(
            error.reason._tag === "RateLimitExceeded"
              ? new RateLimitExceededError()
              : new RateLimitUnavailableError()
          )
        )
      );

  /**
   * Creates a manual changelog consent request. Tokens remain Redacted and
   * are returned only to the caller responsible for creating its future
   * verification-email outbox intent; public RPC responses must omit them.
   */
  const requestChangelogSubscription = Effect.fn(
    "EmailSubscriptionConsent.requestChangelogSubscription"
  )(function* ({
    email: requestedEmail,
    organizationId,
  }: {
    readonly email: string;
    readonly organizationId: string;
  }) {
    const maySubscribe =
      yield* entitlementPolicy.mayCreatePublicEmailSubscriptions(
        organizationId
      );
    if (!maySubscribe) {
      return yield* new Policy.PolicyDeniedError({
        reason:
          "Changelog email subscriptions require the Starter plan or higher.",
      });
    }
    const email = yield* normalizeEmailAddress(
      requestedEmail,
      "requestChangelogSubscription"
    );
    yield* consumeVerificationRequest({ email, organizationId });
    const now = yield* DateTime.nowAsDate;
    const subscription = yield* repository.requestSubscription({
      email,
      now,
      organizationId,
      source: "explicit",
      topic: { topicId: null, topicType: "changelog" },
      verificationExpiresAt: verificationExpiration(now),
    });
    return {
      ...subscription,
      verificationRequired: Option.isSome(subscription.verificationToken),
    };
  });

  const verifySubscription = Effect.fn(
    "EmailSubscriptionConsent.verifySubscription"
  )(function* ({ verificationToken }: { readonly verificationToken: string }) {
    const now = yield* DateTime.nowAsDate;
    yield* repository.verifySubscription({ now, verificationToken });
    // Do not turn this public endpoint into a token-validity oracle.
    return { verified: true };
  });

  const unsubscribe = Effect.fn("EmailSubscriptionConsent.unsubscribe")(
    function* ({ unsubscribeToken }: { readonly unsubscribeToken: string }) {
      const now = yield* DateTime.nowAsDate;
      yield* repository.unsubscribe({ now, unsubscribeToken });
      // This is intentionally idempotent and equally successful for unknown tokens.
      return { unsubscribed: true };
    }
  );

  return {
    requestChangelogSubscription,
    unsubscribe,
    verifySubscription,
  };
});

/** RPC adapter which deliberately removes redacted link tokens from responses. */
export const EmailSubscriptionRpcHandlersEffect = Effect.gen(function* () {
  const consent = yield* EmailSubscriptionConsentHandlersEffect;

  const internalConsentFailure = (
    error:
      | EmailSubscriptionDataError
      | EmailSubscriptionInputError
      | EmailSubscriptionTokenError
  ) =>
    Effect.logError("Email subscription request failed internally", error).pipe(
      Effect.andThen(
        Effect.fail(
          new InternalServerError({
            message: "Could not process the email subscription request",
          })
        )
      )
    );

  return {
    EmailSubscriptionChangelogSubscribePublic: ({
      email,
      organizationId,
    }: {
      readonly email: string;
      readonly organizationId: string;
    }) =>
      consent.requestChangelogSubscription({ email, organizationId }).pipe(
        Effect.map(({ verificationRequired }) => ({ verificationRequired })),
        Effect.catchTags({
          EmailSubscriptionDataError: internalConsentFailure,
          EmailSubscriptionInputError: internalConsentFailure,
          EmailSubscriptionTokenError: internalConsentFailure,
        }),
        withRemapDbErrors("EmailSubscription", "create")
      ),
    EmailSubscriptionUnsubscribePublic: ({
      token,
    }: {
      readonly token: string;
    }) =>
      consent.unsubscribe({ unsubscribeToken: token }).pipe(
        Effect.catchTags({
          EmailSubscriptionDataError: internalConsentFailure,
          EmailSubscriptionTokenError: internalConsentFailure,
        }),
        withRemapDbErrors("EmailSubscription", "update")
      ),
    EmailSubscriptionVerifyPublic: ({ token }: { readonly token: string }) =>
      consent.verifySubscription({ verificationToken: token }).pipe(
        Effect.catchTags({
          EmailSubscriptionDataError: internalConsentFailure,
          EmailSubscriptionTokenError: internalConsentFailure,
        }),
        withRemapDbErrors("EmailSubscription", "update")
      ),
  };
});

export const EmailSubscriptionRpcHandlers = EmailSubscriptionRpcs.toLayer(
  EmailSubscriptionRpcHandlersEffect
).pipe(
  Layer.provide(EmailSubscriptionRepository.layer),
  Layer.provide(
    EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer))
  )
);
