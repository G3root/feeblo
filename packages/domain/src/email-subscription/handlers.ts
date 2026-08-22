import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  type EmailOutboxDataError,
  EmailOutboxRepository,
} from "../email-outbox/repository";
import { wakeEmailOutboxBestEffort } from "../email-outbox/workflow";
import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import {
  RateLimitExceededError,
  RateLimitUnavailableError,
} from "../rate-limit";
import { RateLimitService } from "../rate-limit/service";
import { InternalServerError, withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { EmailSubscriptionRepository } from "./repository";
import { EmailSubscriptionRpcs } from "./rpcs";
import {
  type ChangelogSubscriptionRequest,
  type ChangelogSubscriptionSetRequest,
  type ChangelogSubscriptionStatusRequest,
  type EmailSubscriptionDataError,
  type EmailSubscriptionInputError,
  type EmailSubscriptionTokenRequest,
  parseEmailAddress,
  type SubmissionNotificationPreferenceRequest,
} from "./schema";
import type { EmailSubscriptionTokenError } from "./tokens";

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const EMAIL_SUBSCRIPTION_VERIFICATION_WINDOW = "24 hours";

const verificationExpiration = (now: Date): Date =>
  new Date(now.getTime() + VERIFICATION_TOKEN_TTL_MS);

export const EmailSubscriptionConsentHandlersEffect = Effect.gen(function* () {
  const entitlementPolicy = yield* EntitlementPolicy;
  const repository = yield* EmailSubscriptionRepository;
  const emailOutbox = yield* EmailOutboxRepository;

  const consumeVerificationRequest = (args: {
    readonly email: string;
    readonly organizationId: string;
  }) =>
    Effect.gen(function* () {
      const rateLimitService = yield* RateLimitService;
      return yield* rateLimitService.consume({
        key: `email-subscription:verification-request:${args.organizationId}:${args.email}`,
        limit: 3,
        window: EMAIL_SUBSCRIPTION_VERIFICATION_WINDOW,
      });
    }).pipe(
      Effect.catchTag("RateLimiterError", (error) =>
        Effect.fail(
          error.reason._tag === "RateLimitExceeded"
            ? new RateLimitExceededError()
            : new RateLimitUnavailableError()
        )
      )
    );

  /**
   * Creates a manual changelog consent request. Link tokens remain Redacted,
   * and public RPC responses omit them.
   */
  const requestChangelogSubscription = Effect.fn(
    "EmailSubscriptionConsent.requestChangelogSubscription"
  )(function* ({
    email: requestedEmail,
    organizationId,
  }: ChangelogSubscriptionRequest) {
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
    const email = yield* parseEmailAddress(
      requestedEmail,
      "requestChangelogSubscription"
    );
    yield* consumeVerificationRequest({ email, organizationId });
    const now = yield* DateTime.nowAsDate;
    const verificationExpiresAt = verificationExpiration(now);
    const { outboxId, subscription } = yield* transaction(
      Effect.gen(function* () {
        const requested = yield* repository.requestSubscription({
          email,
          now,
          organizationId,
          source: "explicit",
          topic: { topicId: null, topicType: "changelog" },
          verificationExpiresAt,
        });
        if (Option.isNone(requested.verificationToken)) {
          return { outboxId: undefined, subscription: requested };
        }
        const recorded = yield* emailOutbox.recordIntent({
          aggregateId: requested.subscription.id,
          aggregateType: "email_subscription",
          deduplicationKey: `subscription.verification_requested:${requested.subscription.id}:${now.getTime()}`,
          expiresAt: verificationExpiresAt,
          kind: "subscription.verification_requested",
          organizationId,
          payload: {
            kind: "subscription.verification_requested",
            subscriptionId: requested.subscription.id,
          },
          scheduledAt: now,
        });
        return {
          outboxId:
            recorded._tag === "Inserted" ? recorded.intent.id : undefined,
          subscription: requested,
        };
      })
    );
    yield* wakeEmailOutboxBestEffort(outboxId, organizationId);
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
  const entitlementPolicy = yield* EntitlementPolicy;
  const repository = yield* EmailSubscriptionRepository;
  const sitePolicy = yield* SitePolicy;

  const internalConsentFailure = (
    error:
      | EmailSubscriptionDataError
      | EmailSubscriptionInputError
      | EmailSubscriptionTokenError
      | EmailOutboxDataError
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
    }: ChangelogSubscriptionRequest) =>
      consent.requestChangelogSubscription({ email, organizationId }).pipe(
        // Public reads gate on changelog visibility; subscriptions must not
        // leak hidden entries to outside addresses either.
        Policy.withPublicPolicy(sitePolicy.canViewChangelog(organizationId)),
        Effect.map(({ verificationRequired }) => ({ verificationRequired })),
        Effect.catchTags({
          EmailOutboxDataError: internalConsentFailure,
          EmailSubscriptionDataError: internalConsentFailure,
          EmailSubscriptionInputError: internalConsentFailure,
          EmailSubscriptionTokenError: internalConsentFailure,
        }),
        withRemapDbErrors("EmailSubscription", "create")
      ),
    EmailSubscriptionUnsubscribePublic: ({
      token,
    }: EmailSubscriptionTokenRequest) =>
      consent.unsubscribe({ unsubscribeToken: token }).pipe(
        Effect.catchTags({
          EmailSubscriptionDataError: internalConsentFailure,
          EmailSubscriptionTokenError: internalConsentFailure,
        }),
        withRemapDbErrors("EmailSubscription", "update")
      ),
    EmailSubscriptionVerifyPublic: ({ token }: EmailSubscriptionTokenRequest) =>
      consent.verifySubscription({ verificationToken: token }).pipe(
        Effect.catchTags({
          EmailSubscriptionDataError: internalConsentFailure,
          EmailSubscriptionTokenError: internalConsentFailure,
        }),
        withRemapDbErrors("EmailSubscription", "update")
      ),
    EmailSubscriptionChangelogStatusGet: ({
      organizationId,
    }: ChangelogSubscriptionStatusRequest) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const subscription = yield* repository.findAuthenticatedSubscription({
          organizationId,
          topic: { topicId: null, topicType: "changelog" },
          userId: session.session.userId,
        });
        return {
          subscribed:
            subscription !== null && subscription.state !== "unsubscribed",
        };
      }).pipe(
        Policy.withPolicy(
          Policy.all(
            Policy.hasRestrictedOrganizationScope(organizationId),
            sitePolicy.canViewChangelog(organizationId)
          )
        ),
        withRemapDbErrors("EmailSubscription", "select")
      ),
    EmailSubscriptionChangelogSubscribeSet: ({
      organizationId,
      subscribed,
    }: ChangelogSubscriptionSetRequest) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        // Subscribing is available on every plan; only subscriber email
        // delivery is plan-gated (enforced when intents materialize). The
        // account email is already verified, so subscribing activates
        // immediately without the double opt-in round trip.
        const now = yield* DateTime.nowAsDate;
        if (subscribed) {
          yield* transaction(
            repository.requestSubscription({
              alreadyVerifiedUser: { userId: session.session.userId },
              email: session.user.email,
              now,
              organizationId,
              source: "explicit",
              topic: { topicId: null, topicType: "changelog" },
              verificationExpiresAt: null,
            })
          );
        } else {
          yield* transaction(
            repository.unsubscribeAuthenticatedSubscription({
              now,
              organizationId,
              topic: { topicId: null, topicType: "changelog" },
              userId: session.session.userId,
            })
          );
        }
        return { subscribed };
      }).pipe(
        Policy.withPolicy(
          Policy.all(
            Policy.hasRestrictedOrganizationScope(organizationId),
            sitePolicy.canViewChangelog(organizationId)
          )
        ),
        Effect.catchTags({
          EmailSubscriptionDataError: internalConsentFailure,
          EmailSubscriptionInputError: internalConsentFailure,
          EmailSubscriptionTokenError: internalConsentFailure,
        }),
        withRemapDbErrors("EmailSubscription", "update")
      ),
    EmailSubmissionNotificationPreferenceSet: ({
      enabled,
      organizationId,
    }: SubmissionNotificationPreferenceRequest) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const membership = Policy.getMembership(session, organizationId);
        if (
          membership === undefined ||
          (membership.role !== "owner" && membership.role !== "admin")
        ) {
          return yield* new Policy.PolicyDeniedError({
            reason:
              "Only workspace owners and administrators can receive submission notification email.",
          });
        }
        const now = yield* DateTime.nowAsDate;
        if (enabled) {
          const recipientLimit =
            yield* entitlementPolicy.submissionNotificationRecipientLimit(
              organizationId
            );
          yield* transaction(
            repository.configureSubmissionNotificationRecipient({
              alreadyVerifiedUser: { userId: session.session.userId },
              email: session.user.email,
              now,
              organizationId,
              replaceOtherRecipients: recipientLimit === 1,
              source: "explicit",
              topic: { topicId: null, topicType: "submission" },
              verificationExpiresAt: null,
            })
          );
        } else {
          yield* transaction(
            repository.unsubscribeAuthenticatedSubscription({
              now,
              organizationId,
              topic: { topicId: null, topicType: "submission" },
              userId: session.session.userId,
            })
          );
        }
        return { enabled };
      }).pipe(
        Effect.catchTags({
          EmailSubscriptionDataError: internalConsentFailure,
          EmailSubscriptionInputError: internalConsentFailure,
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
  Layer.provide(EmailOutboxRepository.layer),
  Layer.provide(SitePolicy.layer),
  Layer.provide(SiteRepository.layer),
  Layer.provide(
    EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer))
  )
);

import { transaction } from "@feeblo/db";
