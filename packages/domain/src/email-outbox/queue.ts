import { Database, schema, transaction } from "@feeblo/db";
import type { Database as DatabaseService } from "@feeblo/db/database";
import {
  Mailer,
  MailTemplateRenderError,
  MailTemporaryDeliveryError,
  MailUncertainDeliveryError,
} from "@feeblo/transactional/mailer";
import { createChangelogEmail } from "@feeblo/transactional/templates/changelog";
import { createEmailSubscriptionVerificationEmail } from "@feeblo/transactional/templates/email-subscription-verification";
import { createNotificationEmail } from "@feeblo/transactional/templates/notification";
import { and, eq, gte, isNull, sql, sum } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PersistedQueue from "effect/persistence/PersistedQueue";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import { evaluateOrganizationAccess } from "./access";
import { EmailOutboxConfig } from "./config";
import {
  emailSubscriptionTopicForIntent,
  isChangelogPubliclyVisible,
  makeSubmissionNotificationPayload,
  resolveSubscriptionNotificationContent,
} from "./content";
import { EmailOutboxRepository, type ResumedEmailDelivery } from "./repository";
import {
  ChangelogTemplatePayload,
  EmailUnsubscribeTarget,
  NotificationTemplatePayload,
  SubscriptionVerificationTemplatePayload,
} from "./schema";
import {
  recordEmailDeliveryAccessSkip,
  recordEmailDeliveryRetry,
  recordEmailDeliveryThrottle,
  recordEmailIntentTransition,
  recordEmailOldestQueuedAge,
  recordEmailProviderSubmission,
  recordEmailReconciliationRecoveries,
} from "./telemetry";

const DeliveryAttemptOutcomeSchema = Schema.TaggedUnion({
  retry: {
    delay: Schema.Duration,
    infrastructureFailure: Schema.Boolean,
  },
  terminal: {},
});

type DeliveryAttemptOutcome = Schema.Schema.Type<
  typeof DeliveryAttemptOutcomeSchema
>;

const maximumDeliveryAttempts = 5;
const maximumInfrastructureFailures = 10;
const materializationBatchSize = 100;
const reconciliationBatchSize = 100;
/** Retry delay for a delivery whose `sending` lease has to be reclaimed. */
const sendingLeaseRecoveryDelay = Duration.minutes(5);
/** Retry delay while the internal circuit breaker has delivery paused. */
const circuitBreakerRetryDelay = Duration.minutes(5);
/** Retry delay while the provider's monthly send limit is spent. */
const monthlyVolumeRetryDelay = Duration.hours(1);
/**
 * Backoff before a worker re-enters `take` after a failure.
 *
 * `take` fails fast while the queue store is unavailable, so without this the
 * `forever` loop would hot-spin and flood the log until the store recovers.
 */
const queueTakeRetryDelay = Duration.seconds(1);

// Tokenized unsubscribe/verification links carry a bearer token in the query
// string, so they must never be rendered against a plain-HTTP origin. Loopback
// hosts stay allowed so local development keeps working.
const loopbackHostPattern = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

const retryDelay = (deliveryId: string, attempt: number): Duration.Duration => {
  const exponential = Math.min(60 * 60 * 1000, 1000 * 2 ** (attempt - 1));
  let hash = 0;
  for (const character of deliveryId) {
    hash = (hash * 31 + character.charCodeAt(0)) % 10_000;
  }
  return Duration.millis(
    exponential + Math.floor((exponential * (hash % 2001)) / 10_000)
  );
};

const EmailOutboxIntentQueueItem = Schema.Struct({
  outboxId: Schema.String,
});

const EmailDeliveryQueueItem = Schema.Struct({
  deliveryId: Schema.String,
});

/**
 * Crash backoff owned by the queue itself.
 *
 * This shapes only the recovery of an element whose worker died mid-flight:
 * ordinary retries are scheduled on the row (`next_attempt_at`) and re-offered
 * by reconciliation, so this curve is never what a recipient waits on.
 */
const emailOutboxWorkerCrashSchedule = Schedule.jittered(
  Schedule.min([Schedule.exponential("1 second"), Schedule.spaced("1 hour")])
);

/**
 * Durable handoff between the outbox tables and the two background workers.
 *
 * The database rows stay the source of truth: an element carries only the id of
 * the intent or delivery to work on, so a redelivery after a crash re-reads the
 * row and repeats an idempotent, guarded write.
 */
export class EmailOutboxQueues extends Context.Service<EmailOutboxQueues>()(
  "EmailOutboxQueues",
  {
    make: Effect.gen(function* () {
      return {
        dispatcher: yield* PersistedQueue.make({
          name: "email-outbox-dispatcher",
          schema: EmailOutboxIntentQueueItem,
          maxAttempts: maximumInfrastructureFailures,
          retrySchedule: emailOutboxWorkerCrashSchedule,
        }),
        delivery: yield* PersistedQueue.make({
          name: "email-outbox-delivery",
          schema: EmailDeliveryQueueItem,
          maxAttempts: maximumInfrastructureFailures,
          retrySchedule: emailOutboxWorkerCrashSchedule,
        }),
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}

/**
 * Dispatcher element id, bucketed by the intent's `scheduledAt` and
 * `updatedAt`.
 *
 * A coalescing window can move `scheduledAt` later, so a later bucket has to be
 * offerable again. A resume (or another update) can leave `scheduledAt` alone
 * while making the row due again, so `updatedAt` joins the bucket. Duplicate
 * offers for one revision stay de-duplicated by the queue, which is what keeps
 * a lost wake from double-materializing an intent.
 */
const dispatcherElementId = ({
  id,
  scheduledAt,
  updatedAt,
}: {
  readonly id: string;
  readonly scheduledAt: DateTime.Utc;
  readonly updatedAt: DateTime.Utc;
}): string =>
  `${id}:${DateTime.toEpochMillis(scheduledAt)}:${DateTime.toEpochMillis(updatedAt)}`;

/**
 * Whether an intent row's expiry instant has passed.
 *
 * Drizzle returns `timestamp` columns as `Date`, so convert at the row boundary
 * before comparing against the `DateTime` clock.
 */
const isIntentExpired = (expiresAt: Date | null, now: DateTime.Utc): boolean =>
  expiresAt !== null &&
  DateTime.isLessThanOrEqualTo(DateTime.fromDateUnsafe(expiresAt), now);

/**
 * Delivery element id, bucketed by the row's attempt and transition version.
 *
 * Both parts move when the row becomes due again: the attempt on a claim, the
 * version on any transition. A completed element must never block the next
 * offer, and throttle or plan-resume deferrals do not consume an attempt, so
 * `attempt_count` alone cannot distinguish them.
 */
const deliveryElementId = (
  deliveryId: string,
  attemptCount: number,
  transitionVersion: number
): string => `${deliveryId}:${attemptCount + 1}:${transitionVersion}`;

/** Materializes one durable intent into immutable per-recipient deliveries. */
export const materializeEmailIntent = (outboxId: string) =>
  Effect.gen(function* () {
    const repository = yield* EmailOutboxRepository;
    const { appUrl, appRootDomain } = yield* EmailOutboxConfig;
    const policy = yield* EntitlementPolicy;
    const db = yield* Database.Database;
    const now = yield* DateTime.now;
    const intent = yield* repository.findById(outboxId);
    if (!intent) {
      // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
      return [] as readonly string[];
    }
    if (isIntentExpired(intent.expiresAt, now)) {
      yield* repository.markIntentState({ id: intent.id, state: "expired" });
      yield* recordEmailIntentTransition(intent.kind, "expired");
      // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
      return [] as readonly string[];
    }
    const eligible = yield* policy.mayMaterializeEmailIntent({
      organizationId: intent.organizationId,
      kind: intent.kind,
    });
    if (!eligible) {
      if (intent.state === "pending") {
        yield* repository.markIntentState({
          id: intent.id,
          state: "paused_by_plan",
        });
        yield* recordEmailIntentTransition(intent.kind, "paused_by_plan");
        // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
      }
      // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
      return [] as readonly string[];
    }
    if (intent.state === "paused_by_plan") {
      // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
      if (!(yield* repository.resumePausedIntent({ id: intent.id }))) {
        // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
        return [] as readonly string[];
        // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
        // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
      }
      // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
    } else if (intent.state !== "pending") {
      // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
      return [] as readonly string[];
    }

    if (intent.payload.kind === "subscription.verification_requested") {
      const [recipient] = yield* db
        .select({
          contactId: schema.emailContactTable.id,
          email: schema.emailContactTable.email,
          subscriptionId: schema.emailSubscriptionTable.id,
        })
        .from(schema.emailSubscriptionTable)
        .innerJoin(
          schema.emailContactTable,
          eq(
            schema.emailContactTable.id,
            schema.emailSubscriptionTable.contactId
          )
        )
        .where(
          and(
            eq(schema.emailSubscriptionTable.id, intent.payload.subscriptionId),
            eq(
              schema.emailSubscriptionTable.organizationId,
              intent.organizationId
            ),
            eq(schema.emailSubscriptionTable.state, "pending_verification")
          )
        )
        .limit(1);
      // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
      // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
      if (recipient === undefined) {
        // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
        yield* repository.markIntentState({ id: intent.id, state: "expired" });
        // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
        yield* recordEmailIntentTransition(intent.kind, "expired");
        // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
        return [] as readonly string[];
      }
      return yield* transaction(
        Effect.gen(function* () {
          const created = yield* repository.createDelivery({
            contactId: recipient.contactId,
            outboxId: intent.id,
            recipientEmail: recipient.email,
            template: "subscription-verification",
            templatePayload: { subscriptionId: recipient.subscriptionId },
            templateVersion: 1,
          });
          yield* repository.markIntentState({
            id: intent.id,
            state: "materialized",
          });
          yield* recordEmailIntentTransition(intent.kind, "materialized");
          return created._tag === "Inserted" ? [created.delivery.id] : [];
        })
      );
    }

    if (intent.payload.kind === "submission.created") {
      const post = yield* db.query.postTable.findFirst({
        where: {
          id: intent.payload.postId,
          organizationId: intent.organizationId,
        },
        columns: { slug: true, title: true },
        with: { board: { columns: { slug: true } } },
        // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
        // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
      });
      // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
      if (!post) {
        // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
        yield* repository.markIntentState({ id: intent.id, state: "expired" });
        // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
        yield* recordEmailIntentTransition(intent.kind, "expired");
        // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
        return [] as readonly string[];
      }

      const recipientLimit = yield* policy.submissionNotificationRecipientLimit(
        intent.organizationId
      );
      const members = yield* db.query.memberTable.findMany({
        where: { organizationId: intent.organizationId },
        columns: { role: true, userId: true },
        with: { user: { columns: { email: true } } },
      });
      const optedInContacts = yield* db
        .select({
          email: schema.emailContactTable.email,
          userId: schema.emailContactTable.userId,
        })
        .from(schema.emailSubscriptionTable)
        .innerJoin(
          schema.emailContactTable,
          eq(
            schema.emailContactTable.id,
            schema.emailSubscriptionTable.contactId
          )
        )
        .where(
          and(
            eq(
              schema.emailSubscriptionTable.organizationId,
              intent.organizationId
            ),
            eq(schema.emailSubscriptionTable.topicType, "submission"),
            isNull(schema.emailSubscriptionTable.topicId),
            eq(schema.emailSubscriptionTable.state, "active"),
            eq(schema.emailContactTable.verificationState, "verified")
          )
        );
      const privilegedUserIds = new Set(
        members.flatMap((member) =>
          member.role === "owner" || member.role === "admin"
            ? [member.userId]
            : []
        )
      );
      const ownerEmail = members.find((member) => member.role === "owner")?.user
        ?.email;
      const configuredFreeRecipient = optedInContacts[0]?.email;
      const recipients =
        recipientLimit === 1
          ? [configuredFreeRecipient ?? ownerEmail].filter(
              (email): email is string => email !== undefined
            )
          : optedInContacts.flatMap((contact) =>
              contact.userId !== null && privilegedUserIds.has(contact.userId)
                ? [contact.email]
                : []
            );
      const templatePayload = makeSubmissionNotificationPayload(
        appUrl,
        intent.organizationId,
        post
      );

      return yield* transaction(
        Effect.gen(function* () {
          const created = yield* Effect.forEach(recipients, (recipientEmail) =>
            repository.createDelivery({
              outboxId: intent.id,
              recipientEmail,
              template: "submission-notification",
              templateVersion: 1,
              templatePayload,
            })
          );
          yield* repository.markIntentState({
            id: intent.id,
            state: "materialized",
          });
          yield* recordEmailIntentTransition(intent.kind, "materialized");
          return created.flatMap((result) =>
            result._tag === "Inserted" ? [result.delivery.id] : []
          );
        })
      );
    }

    const content = yield* resolveSubscriptionNotificationContent(
      appUrl,
      // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
      // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
      intent,
      appRootDomain
      // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
    );
    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
    if (!content) {
      // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
      yield* repository.markIntentState({ id: intent.id, state: "expired" });
      // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
      yield* recordEmailIntentTransition(intent.kind, "expired");
      // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
      return [] as readonly string[];
    }
    return yield* transaction(
      Effect.gen(function* () {
        const txDb = yield* Database.Database;
        const recipients = yield* txDb
          .select({
            contactId: schema.emailContactTable.id,
            email: schema.emailContactTable.email,
            subscriptionId: schema.emailSubscriptionTable.id,
          })
          .from(schema.emailSubscriptionTable)
          .innerJoin(
            schema.emailContactTable,
            eq(
              schema.emailContactTable.id,
              schema.emailSubscriptionTable.contactId
            )
          )
          .leftJoin(
            schema.emailSuppressionTable,
            eq(
              schema.emailSuppressionTable.email,
              schema.emailContactTable.email
            )
          )
          .leftJoin(
            schema.emailDeliveryTable,
            and(
              eq(schema.emailDeliveryTable.outboxId, intent.id),
              eq(
                schema.emailDeliveryTable.recipientEmail,
                schema.emailContactTable.email
              )
            )
          )
          .where(
            and(
              eq(
                schema.emailSubscriptionTable.organizationId,
                intent.organizationId
              ),
              eq(
                schema.emailSubscriptionTable.topicType,
                content.topic.topicType
              ),
              content.topic.topicId === null
                ? isNull(schema.emailSubscriptionTable.topicId)
                : eq(
                    schema.emailSubscriptionTable.topicId,
                    content.topic.topicId
                  ),
              eq(schema.emailSubscriptionTable.state, "active"),
              eq(schema.emailContactTable.verificationState, "verified"),
              isNull(schema.emailSuppressionTable.email),
              isNull(schema.emailDeliveryTable.id)
            )
          )
          .orderBy(schema.emailSubscriptionTable.id)
          .limit(materializationBatchSize);

        const created = yield* Effect.forEach(recipients, (recipient) => {
          // Persist only the subscription ID. The purpose-bound bearer token
          // is derived immediately before send and remains hash-only at rest.
          return repository.createDelivery({
            outboxId: intent.id,
            contactId: recipient.contactId,
            recipientEmail: recipient.email,
            template: content.template,
            templateVersion: 1,
            templatePayload: {
              ...content.templatePayload,
              unsubscribe: {
                kind: "subscription",
                subscriptionId: recipient.subscriptionId,
              },
            },
          });
        });
        if (recipients.length < materializationBatchSize) {
          yield* repository.markIntentState({
            id: intent.id,
            state: "materialized",
          });
          yield* recordEmailIntentTransition(intent.kind, "materialized");
        }
        return created.flatMap((result) =>
          result?._tag === "Inserted" ? [result.delivery.id] : []
        );
      })
    );
  });

const sendDeliveryAttempt = (
  deliveryId: string,
  observedVersionRef: Ref.Ref<Option.Option<number>>
) =>
  Effect.gen(function* () {
    const repository = yield* EmailOutboxRepository;
    const subscriptions = yield* EmailSubscriptionRepository;
    const policy = yield* EntitlementPolicy;
    const db = yield* Database.Database;
    const config = yield* EmailOutboxConfig;
    const { apiUrl } = config;
    // Builds an API-origin link embedding a purpose-bound token, but only
    // over HTTPS (loopback excepted); otherwise the send fails terminally.
    const deriveTokenizedUrl = (path: string, token: string) =>
      Effect.gen(function* () {
        const url = yield* Effect.try({
          try: () => new URL(`${apiUrl}${path}`),
          catch: (cause) =>
            new MailTemplateRenderError({
              cause,
              message: "Email link derivation failed: invalid API URL",
              operation: "derive tokenized link",
            }),
        });
        if (url.protocol !== "https:" && !loopbackHostPattern.test(url.host)) {
          return yield* new MailTemplateRenderError({
            message: `Email link derivation failed: API_URL must use HTTPS, got ${url.protocol}`,
            operation: "derive tokenized link",
          });
        }
        return `${url.origin}${url.pathname}?token=${encodeURIComponent(token)}`;
      });
    const now = yield* DateTime.now;
    const delivery = yield* repository.findDeliveryById(deliveryId);
    if (
      !(delivery && ["queued", "deferred", "sending"].includes(delivery.state))
    ) {
      return { _tag: "terminal" as const };
    }
    // Remember the version this attempt observed so the infrastructure catch
    // can prove the row still belongs to it before deferring.
    yield* Ref.set(observedVersionRef, Option.some(delivery.transitionVersion));
    // A prior activity may have claimed this row and then lost its worker
    // before persisting the result. Do not complete the deterministic workflow
    // in that state: reconciliation will release the lease, after which this
    // same workflow execution safely resumes the guarded claim.
    if (delivery.state === "sending") {
      return {
        _tag: "retry" as const,
        delay: sendingLeaseRecoveryDelay,
        infrastructureFailure: true,
      };
    }
    const intent = yield* repository.findById(delivery.outboxId);
    if (!intent || isIntentExpired(intent.expiresAt, now)) {
      yield* repository.markDeliveryOutcome({
        id: delivery.id,
        state: "expired",
      });
      return { _tag: "terminal" as const };
    }
    if (
      config.globalDeliveryPaused ||
      config.pausedWorkspaceIds.has(intent.organizationId)
    ) {
      const reason = config.globalDeliveryPaused
        ? "global_circuit_breaker"
        : "workspace_circuit_breaker";
      yield* recordEmailDeliveryThrottle(reason);
      yield* Effect.logWarning(
        "Email delivery paused by internal circuit breaker"
      ).pipe(
        Effect.annotateLogs({
          deliveryId,
          organizationId: intent.organizationId,
          reason,
        })
      );
      yield* repository.deferDeliveryForThrottle({
        id: delivery.id,
        nextAttemptAt: DateTime.toDateUtc(
          DateTime.addDuration(now, circuitBreakerRetryDelay)
        ),
        reason,
      });
      return {
        _tag: "retry" as const,
        delay: circuitBreakerRetryDelay,
        infrastructureFailure: false,
      };
    }
    const monthStart = DateTime.toDateUtc(DateTime.startOf(now, "month"));
    const [monthlyVolume] = yield* db
      .select({ attempts: sum(schema.emailDeliveryTable.attemptCount) })
      .from(schema.emailDeliveryTable)
      .where(gte(schema.emailDeliveryTable.createdAt, monthStart));
    if (Number(monthlyVolume?.attempts ?? 0) >= config.monthlySendLimit) {
      yield* recordEmailDeliveryThrottle("monthly_volume_limit");
      yield* Effect.logWarning(
        "Email delivery paused by monthly volume limit"
      ).pipe(
        Effect.annotateLogs({
          deliveryId,
          organizationId: intent.organizationId,
        })
      );
      yield* repository.deferDeliveryForThrottle({
        id: delivery.id,
        nextAttemptAt: DateTime.toDateUtc(
          DateTime.addDuration(now, monthlyVolumeRetryDelay)
        ),
        reason: "monthly_volume_limit",
      });
      return {
        _tag: "retry" as const,
        delay: monthlyVolumeRetryDelay,
        infrastructureFailure: false,
      };
    }
    if (
      !(yield* policy.mayMaterializeEmailIntent({
        organizationId: intent.organizationId,
        kind: intent.kind,
      }))
    ) {
      yield* repository.markDeliveryOutcome({
        id: delivery.id,
        state: "paused_by_plan",
      });
      return { _tag: "terminal" as const };
    }
    if (
      delivery.contactId !== null &&
      intent.kind !== "subscription.verification_requested"
    ) {
      const topic = emailSubscriptionTopicForIntent(intent.payload);
      const [activeSubscription] =
        topic === undefined
          ? []
          : yield* db
              .select({ id: schema.emailSubscriptionTable.id })
              .from(schema.emailSubscriptionTable)
              .innerJoin(
                schema.emailContactTable,
                eq(
                  schema.emailContactTable.id,
                  schema.emailSubscriptionTable.contactId
                )
              )
              .where(
                and(
                  eq(
                    schema.emailSubscriptionTable.contactId,
                    delivery.contactId
                  ),
                  eq(
                    schema.emailSubscriptionTable.organizationId,
                    intent.organizationId
                  ),
                  eq(schema.emailSubscriptionTable.topicType, topic.topicType),
                  topic.topicId === null
                    ? isNull(schema.emailSubscriptionTable.topicId)
                    : eq(schema.emailSubscriptionTable.topicId, topic.topicId),
                  eq(schema.emailSubscriptionTable.state, "active"),
                  eq(schema.emailContactTable.verificationState, "verified")
                )
              )
              .limit(1);
      if (activeSubscription === undefined) {
        yield* repository.markDeliveryOutcome({
          id: delivery.id,
          state: "suppressed",
        });
        return { _tag: "terminal" as const };
      }
    }
    const [suppressed] = yield* db
      .select({ email: schema.emailSuppressionTable.email })
      .from(schema.emailSuppressionTable)
      .where(eq(schema.emailSuppressionTable.email, delivery.recipientEmail))
      .limit(1);
    if (suppressed) {
      yield* repository.markDeliveryOutcome({
        id: delivery.id,
        state: "suppressed",
      });
      return { _tag: "terminal" as const };
    }
    // Organization-access gate for post-attributed notifications
    // (plan-on-behalf.md, "Notification eligibility"). Runs after consent so
    // verified double-opt-in external subscribers (no feeblo account) keep
    // their consent-based delivery; the gate only restricts recipients whose
    // account can be resolved. Re-evaluated per attempt, so a recipient who
    // gains access later receives subsequent deliveries with no backfill.
    // Changelog topics are public broadcasts and stay out of scope.
    if (
      intent.aggregateType === "post" &&
      intent.kind !== "subscription.verification_requested"
    ) {
      // Resolve the recipient's account: through the delivery's contact link
      // first, then by the recipient email.
      let account: {
        id: string;
        email: string;
        emailVerified: boolean;
        restrictedToOrganizationId: string | null;
      } | null = null;
      if (delivery.contactId !== null) {
        const [contactLink] = yield* db
          .select({ userId: schema.emailContactTable.userId })
          .from(schema.emailContactTable)
          .where(
            and(
              eq(schema.emailContactTable.id, delivery.contactId),
              eq(schema.emailContactTable.organizationId, intent.organizationId)
            )
          )
          .limit(1);
        if (contactLink?.userId != null) {
          const [linkedAccount] = yield* db
            .select({
              id: schema.userTable.id,
              email: schema.userTable.email,
              emailVerified: schema.userTable.emailVerified,
              restrictedToOrganizationId:
                schema.userTable.restrictedToOrganizationId,
            })
            .from(schema.userTable)
            .where(eq(schema.userTable.id, contactLink.userId))
            .limit(1);
          account = linkedAccount ?? null;
        }
      }
      if (account === null) {
        const [byEmail] = yield* db
          .select({
            id: schema.userTable.id,
            email: schema.userTable.email,
            emailVerified: schema.userTable.emailVerified,
            restrictedToOrganizationId:
              schema.userTable.restrictedToOrganizationId,
          })
          .from(schema.userTable)
          .where(
            sql`lower(${schema.userTable.email}) = lower(${delivery.recipientEmail})`
          )
          .limit(1);
        account = byEmail ?? null;
      }

      // No resolvable account means the recipient is a pure external
      // subscriber; their consent was already proven above.
      if (account !== null) {
        const [postBoard] = yield* db
          .select({ visibility: schema.boardTable.visibility })
          .from(schema.postTable)
          .innerJoin(
            schema.boardTable,
            eq(schema.boardTable.id, schema.postTable.boardId)
          )
          .where(
            and(
              eq(schema.postTable.id, intent.aggregateId),
              eq(schema.postTable.organizationId, intent.organizationId)
            )
          )
          .limit(1);

        const [memberRow] = yield* db
          .select({ id: schema.memberTable.id })
          .from(schema.memberTable)
          .where(
            and(
              eq(schema.memberTable.organizationId, intent.organizationId),
              eq(schema.memberTable.userId, account.id)
            )
          )
          .limit(1);

        const accessVerdict = evaluateOrganizationAccess({
          account,
          hasMembership: memberRow !== undefined,
          // A post or board that no longer resolves fails rule 3 fail-closed
          // without affecting rules 1–2.
          boardVisibility: postBoard?.visibility ?? null,
          organizationId: intent.organizationId,
        });
        if (!accessVerdict.eligible) {
          yield* recordEmailDeliveryAccessSkip(accessVerdict.recipientClass);
          yield* Effect.logWarning(
            "Email delivery skipped: recipient lacks organization access"
          ).pipe(
            Effect.annotateLogs({
              deliveryId,
              organizationId: intent.organizationId,
              recipientClass: accessVerdict.recipientClass,
            })
          );
          yield* repository.markDeliveryOutcome({
            id: delivery.id,
            state: "no_organization_access",
          });
          return { _tag: "terminal" as const };
        }
      }
    }
    const claimedVersion = yield* repository.claimDeliveryForSending({
      id: delivery.id,
      now: DateTime.toDateUtc(now),
    });
    if (claimedVersion === undefined) {
      return { _tag: "terminal" as const };
    }
    yield* Ref.set(observedVersionRef, Option.some(claimedVersion));
    // Resolves the unsubscribe target into a rendered mail message: settings
    // targets use their stored URL directly, subscription targets derive a
    // purpose-bound bearer token and add List-Unsubscribe one-click headers.
    const resolveUnsubscribedEmail = <
      Mail extends { readonly subject: string },
    >(
      unsubscribe: Schema.Schema.Type<typeof EmailUnsubscribeTarget>,
      createEmail: (unsubscribeUrl: string) => Mail
    ) =>
      Effect.gen(function* () {
        if (unsubscribe.kind === "settings") {
          return createEmail(unsubscribe.url);
        }
        const token = yield* subscriptions.deriveLinkToken({
          purpose: "unsubscribe",
          subscriptionId: unsubscribe.subscriptionId,
        });
        const unsubscribeUrl = yield* deriveTokenizedUrl(
          "/api/email-subscriptions/unsubscribe",
          Redacted.value(token)
        );
        return {
          ...createEmail(unsubscribeUrl),
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        };
      });
    const resolvedMailMessage = yield* Effect.gen(function* () {
      if (delivery.template === "subscription-verification") {
        const payload = yield* Schema.decodeUnknownEffect(
          SubscriptionVerificationTemplatePayload
        )(delivery.templatePayload).pipe(
          Effect.mapError(
            (cause) =>
              new MailTemplateRenderError({
                cause,
                message:
                  "Email template rendering failed: invalid subscription verification payload",
                operation: "decode verification payload",
              })
          )
        );
        const token = yield* subscriptions.deriveLinkToken({
          purpose: "verification",
          subscriptionId: payload.subscriptionId,
        });
        const verificationUrl = yield* deriveTokenizedUrl(
          "/api/email-subscriptions/verify",
          Redacted.value(token)
        );
        return createEmailSubscriptionVerificationEmail({ verificationUrl });
      }

      if (delivery.template === "changelog") {
        const payload = yield* Schema.decodeUnknownEffect(
          ChangelogTemplatePayload
        )(delivery.templatePayload).pipe(
          Effect.mapError(
            (cause) =>
              new MailTemplateRenderError({
                cause,
                message:
                  "Email template rendering failed: invalid changelog payload",
                operation: "decode changelog payload",
              })
          )
        );
        // Payload minus `unsubscribe` is structurally ChangelogEmailProps.
        const { unsubscribe, ...props } = payload;
        return yield* resolveUnsubscribedEmail(unsubscribe, (unsubscribeUrl) =>
          createChangelogEmail({ ...props, unsubscribeUrl })
        );
      }

      const payload = yield* Schema.decodeUnknownEffect(
        NotificationTemplatePayload
      )(delivery.templatePayload).pipe(
        Effect.mapError(
          (cause) =>
            new MailTemplateRenderError({
              cause,
              message:
                "Email template rendering failed: invalid notification payload",
              operation: "decode notification payload",
            })
        )
      );
      return yield* resolveUnsubscribedEmail(
        payload.unsubscribe,
        (unsubscribeUrl) =>
          createNotificationEmail({ ...payload, unsubscribeUrl })
      );
    }).pipe(
      Effect.asSome,
      // Template/link derivation failures are permanent (including insecure
      // API_URL): mark the delivery failed instead of churning through
      // infrastructure retries, and finish the attempt terminally.
      Effect.catchTag("MailTemplateRenderError", (error) =>
        repository
          .markDeliveryOutcome({
            id: delivery.id,
            state: "failed",
            lastError: { tag: error._tag },
          })
          .pipe(Effect.as(Option.none()))
      )
    );
    if (Option.isNone(resolvedMailMessage)) {
      return { _tag: "terminal" as const };
    }
    const mailer = yield* Mailer;
    const deliveryPlan =
      (yield* policy.submissionNotificationRecipientLimit(
        intent.organizationId
      )) === 1
        ? "free"
        : "paid";
    const deferAfterRetryableProviderFailure = (
      error: MailTemporaryDeliveryError | MailUncertainDeliveryError
    ) => {
      const attempt = delivery.attemptCount + 1;
      if (attempt >= maximumDeliveryAttempts) {
        return repository
          .markDeliveryOutcome({
            id: delivery.id,
            state: "failed",
            lastError: { tag: error._tag, reason: "retry_exhausted" },
          })
          .pipe(Effect.as<DeliveryAttemptOutcome>({ _tag: "terminal" }));
      }
      const delay = retryDelay(delivery.id, attempt);
      return Effect.gen(function* () {
        const deferred = yield* repository.deferSendingDelivery({
          id: delivery.id,
          expectedTransitionVersion: claimedVersion,
          nextAttemptAt: DateTime.toDateUtc(DateTime.addDuration(now, delay)),
          lastError: { tag: error._tag },
        });
        // Zero rows means a newer attempt owns the row; this one must not
        // record a retry it did not schedule.
        if (!deferred) {
          return { _tag: "terminal" as const };
        }
        yield* recordEmailDeliveryRetry(error._tag);
        return {
          _tag: "retry" as const,
          delay,
          infrastructureFailure: false,
        };
      });
    };
    // Queued deliveries may wait out throttles and retries; re-check the
    // changelog read boundary as the last step before provider submission so
    // content hidden after materialization is never emailed.
    if (
      emailSubscriptionTopicForIntent(intent.payload)?.topicType ===
        "changelog" &&
      !(yield* isChangelogPubliclyVisible(
        intent.organizationId,
        // SAFETY: a changelog topic implies a changelog payload variant,
        // which always carries the changelogId.
        "changelogId" in intent.payload ? intent.payload.changelogId : undefined
      ))
    ) {
      yield* repository.markDeliveryOutcome({
        id: delivery.id,
        state: "suppressed",
      });
      return { _tag: "terminal" as const };
    }
    const sent = yield* mailer
      .send({
        ...resolvedMailMessage.value,
        messageId: delivery.messageId,
        to: delivery.recipientEmail,
      })
      .pipe(
        Effect.map((result) => ({
          _tag: "accepted" as const,
          accepted: result.accepted,
          providerMetadata: result.providerMetadata,
        })),
        Effect.catchTags({
          MailPermanentDeliveryError: (error) =>
            repository
              .markDeliveryOutcome({
                id: delivery.id,
                state: "failed",
                lastError: { tag: error._tag },
              })
              .pipe(Effect.as<DeliveryAttemptOutcome>({ _tag: "terminal" })),
          MailTemplateRenderError: (error) =>
            repository
              .markDeliveryOutcome({
                id: delivery.id,
                state: "failed",
                lastError: { tag: error._tag },
              })
              .pipe(Effect.as<DeliveryAttemptOutcome>({ _tag: "terminal" })),
          MailTemporaryDeliveryError: deferAfterRetryableProviderFailure,
          MailUncertainDeliveryError: (error) =>
            repository
              .markDeliveryOutcome({
                id: delivery.id,
                state: "failed",
                lastError: {
                  tag: error._tag,
                  reason: "ambiguous_submission_not_retried",
                },
              })
              .pipe(Effect.as<DeliveryAttemptOutcome>({ _tag: "terminal" })),
        }),
        Effect.flatMap((result) => {
          if (result._tag !== "accepted") {
            return Effect.succeed(result);
          }
          if (result.accepted) {
            return repository
              .markDeliveryAccepted({
                id: delivery.id,
                acceptedAt: DateTime.toDateUtc(now),
                providerMetadata: result.providerMetadata,
              })
              .pipe(
                Effect.tap((accepted) =>
                  accepted
                    ? recordEmailProviderSubmission(
                        intent.kind,
                        config.estimatedSendCostMicros,
                        deliveryPlan
                      )
                    : Effect.void
                ),
                Effect.as<DeliveryAttemptOutcome>({ _tag: "terminal" })
              );
          }
          if (result.providerMetadata.rejectedRecipientCount > 0) {
            return repository
              .markDeliveryOutcome({
                id: delivery.id,
                state: "failed",
                lastError: {
                  tag: "MailPermanentDeliveryError",
                  reason: "provider_rejected",
                },
              })
              .pipe(Effect.as<DeliveryAttemptOutcome>({ _tag: "terminal" }));
          }
          return repository
            .markDeliveryOutcome({
              id: delivery.id,
              state: "failed",
              lastError: {
                tag: "MailUncertainDeliveryError",
                reason: "ambiguous_submission_not_retried",
              },
            })
            .pipe(Effect.as<DeliveryAttemptOutcome>({ _tag: "terminal" }));
        })
      );
    return sent;
  });

/**
 * Shape of the retry bookkeeping stored on `email_delivery.last_error`.
 *
 * The consecutive-infrastructure counter lives on the row rather than in the
 * worker loop so a redelivery after a crash resumes the same budget instead of
 * starting the count over. Provider and throttle deferrals write a different
 * `tag` without the counter, which decodes to zero and resets the budget — the
 * same reset the workflow previously applied to a non-infrastructure failure.
 */
const EmailDeliveryRetryState = Schema.Struct({
  consecutiveInfrastructureFailures: Schema.Finite,
  tag: Schema.String,
});

/** Marks an intent failed once its infrastructure budget is spent. */
const failIntentAfterInfrastructureExhaustion = (outboxId: string) =>
  Effect.gen(function* () {
    const repository = yield* EmailOutboxRepository;
    const intent = yield* repository.findById(outboxId);
    if (intent === undefined) {
      return;
    }
    const failed = yield* repository.markIntentState({
      id: outboxId,
      state: "failed",
    });
    if (failed) {
      yield* recordEmailIntentTransition(intent.kind, "failed");
    }
  }).pipe(
    // The write is the only record that the intent's budget is spent, so a
    // failure must fail the element. `take` then re-offers it under the same
    // id instead of acknowledging work whose row never moved.
    Effect.tapError((error) =>
      Effect.logError("Could not persist exhausted email outbox intent", error)
    )
  );

/**
 * Retry curve for a dispatcher element whose database work kept failing.
 *
 * The intent row carries no attempt counter, so this budget is the only bound
 * on dispatch retries; the queue's own `maxAttempts` is a crash net behind it.
 */
const dispatchRetrySchedule = (outboxId: string): Schedule.Schedule<number> =>
  Schedule.recurs(maximumInfrastructureFailures - 1).pipe(
    Schedule.modifyDelay(({ attempt }) =>
      Effect.succeed(retryDelay(outboxId, attempt))
    )
  );

/**
 * Materializes one due intent into per-recipient deliveries.
 *
 * A future `scheduledAt` returns without work. The coalescing window belongs to
 * the row: reconciliation offers a later bucket once the intent comes due.
 * Sleeping in this worker instead would pin a slot for the whole window and, on
 * a crash, spend the intent's attempt budget on waiting rather than on work.
 */
export const dispatchEmailOutboxIntent = Effect.fn("dispatchEmailOutboxIntent")(
  function* ({ outboxId }: { readonly outboxId: string }) {
    const repository = yield* EmailOutboxRepository;
    const { maxConcurrentSends } = yield* EmailOutboxConfig;

    const materializeDueIntent = Effect.gen(function* () {
      let hasMoreRecipients = true;
      while (hasMoreRecipients) {
        const intent = yield* repository.findById(outboxId);
        if (intent === undefined || intent.state !== "pending") {
          return;
        }
        // The coalescing window belongs to the row. Returning completes this
        // element; reconciliation offers a later bucket once the row is due.
        if (
          yield* DateTime.isFuture(DateTime.fromDateUnsafe(intent.scheduledAt))
        ) {
          return;
        }
        const deliveryIds = yield* materializeEmailIntent(outboxId);
        yield* Effect.forEach(
          deliveryIds,
          (deliveryId) => enqueueEmailDelivery(deliveryId, 0, 0),
          { concurrency: maxConcurrentSends, discard: true }
        );
        hasMoreRecipients = deliveryIds.length > 0;
      }
    });

    yield* materializeDueIntent.pipe(
      Effect.retryOrElse(dispatchRetrySchedule(outboxId), (error) =>
        Effect.logError("Email outbox dispatch retries exhausted", error).pipe(
          Effect.annotateLogs({ outboxId }),
          Effect.andThen(failIntentAfterInfrastructureExhaustion(outboxId))
        )
      )
    );
  }
);

/**
 * Attempts one delivery, deferring it on the schedule the row records.
 *
 * Each element is a single attempt. A retry outcome writes `next_attempt_at`
 * (and, for infrastructure failures, the consecutive-failure count) onto the
 * row and returns; reconciliation re-offers the row when it is due, with a
 * fresh element id from the bumped `transition_version`. That keeps the retry
 * delay off a worker slot, which a `retryDelay` of up to an hour would
 * otherwise hold. The queue's own `retrySchedule` still covers a worker that
 * dies with the element claimed.
 */
export const deliverEmailDelivery = Effect.fn("deliverEmailDelivery")(
  function* ({ deliveryId }: { readonly deliveryId: string }) {
    const repository = yield* EmailOutboxRepository;
    const delivery = yield* repository.findDeliveryById(deliveryId);
    if (delivery === undefined) {
      return;
    }

    // `last_error` is untyped JSON on the row, so parse the retry bookkeeping at
    // this boundary rather than trusting a shape the column cannot express. A
    // deferral written by a provider or throttle path carries no counter, and
    // therefore resumes the infrastructure budget at zero.
    const retryState = Schema.decodeUnknownOption(EmailDeliveryRetryState)(
      delivery.lastError
    );
    const infrastructureFailures = Option.isSome(retryState)
      ? retryState.value.consecutiveInfrastructureFailures
      : 0;

    // `sendDeliveryAttempt` records the row version it observed here, so a
    // failure can defer against the version this attempt actually holds
    // rather than clobbering a newer claim.
    const observedVersionRef = yield* Ref.make(Option.none<number>());
    const outcome = yield* sendDeliveryAttempt(
      deliveryId,
      observedVersionRef
    ).pipe(
      // Preserve repository-level typed failures; only the residual
      // infrastructure channel (SqlError and other untyped drivers)
      // collapses into a deferral that advances the infrastructure budget.
      Effect.catch((error) => {
        const delay = retryDelay(deliveryId, delivery.attemptCount + 1);
        const nextInfrastructureFailures = infrastructureFailures + 1;
        return Effect.gen(function* () {
          const observedVersion = yield* Ref.get(observedVersionRef);
          const expectedTransitionVersion = Option.getOrElse(
            observedVersion,
            () => delivery.transitionVersion
          );
          yield* Effect.logWarning(
            "Email delivery infrastructure failure, deferring"
          ).pipe(
            Effect.annotateLogs({
              attempt: delivery.attemptCount + 1,
              delay,
              deliveryId,
              error,
            })
          );
          const now = yield* DateTime.now;
          const deferred = yield* repository.deferSendingDelivery({
            id: deliveryId,
            expectedTransitionVersion,
            nextAttemptAt: DateTime.toDateUtc(DateTime.addDuration(now, delay)),
            lastError: {
              consecutiveInfrastructureFailures: nextInfrastructureFailures,
              tag: "EmailDeliveryActivityError",
            },
          });
          // Zero rows means a newer attempt owns the row, so this one is a
          // stale no-op. A deferral that throws still fails the element so
          // the queue retries it under the same id rather than completing
          // without a row transition.
          return deferred
            ? {
                _tag: "retry" as const,
                delay,
                infrastructureFailure: true,
              }
            : { _tag: "terminal" as const };
        });
      })
    );
    if (outcome._tag === "terminal") {
      return;
    }
    const nextInfrastructureFailures = outcome.infrastructureFailure
      ? infrastructureFailures + 1
      : 0;
    if (nextInfrastructureFailures >= maximumInfrastructureFailures) {
      yield* repository
        .markDeliveryOutcome({
          id: deliveryId,
          state: "failed",
          lastError: {
            tag: "EmailDeliveryInfrastructureFailure",
            reason: "retry_exhausted",
          },
        })
        .pipe(
          // As above: swallowing this would complete the queue element with
          // the delivery still mid-retry on the row. Fail so the element is
          // retried and the terminal write is attempted again.
          Effect.tapError((error) =>
            Effect.logError("Could not persist exhausted email delivery", error)
          )
        );
      return;
    }
    // The deferral is on the row; reconciliation is the only scheduler.
  }
);

/**
 * Forks the concurrent take loops that drain the outbox queues.
 *
 * Each `take` error channel carries the handler's failures — including a
 * persistence error propagated from a terminal write — plus the queue's own
 * `PersistedQueueError`. The take scope has already re-offered the element, so
 * the loops log the cause and continue instead of taking the layer down.
 */
export const EmailOutboxWorkerLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const { maxConcurrentSends } = yield* EmailOutboxConfig;
    const queues = yield* EmailOutboxQueues;
    const dispatcherWorker = queues.dispatcher
      .take(dispatchEmailOutboxIntent)
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(
            "Email outbox dispatcher element failed",
            cause
          ).pipe(Effect.andThen(Effect.sleep(queueTakeRetryDelay)))
        ),
        Effect.forever
      );
    const deliveryWorker = queues.delivery.take(deliverEmailDelivery).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Email delivery element failed", cause).pipe(
          Effect.andThen(Effect.sleep(queueTakeRetryDelay))
        )
      ),
      Effect.forever
    );
    yield* Effect.forEach(
      Array.from({ length: maxConcurrentSends }, (_, index) => index),
      () => dispatcherWorker.pipe(Effect.forkScoped),
      { discard: true }
    );
    yield* Effect.forEach(
      Array.from({ length: maxConcurrentSends }, (_, index) => index),
      () => deliveryWorker.pipe(Effect.forkScoped),
      { discard: true }
    );
  })
);

/**
 * Enqueues one delivery attempt for the row's persisted attempt and transition
 * version, so a completed element never blocks a later due transition.
 */
export const enqueueEmailDelivery = (
  deliveryId: string,
  attemptCount: number,
  transitionVersion: number
): Effect.Effect<
  string,
  PersistedQueue.PersistedQueueError | Schema.SchemaError,
  EmailOutboxQueues
> =>
  Effect.flatMap(EmailOutboxQueues, (queues) =>
    queues.delivery.offer(
      { deliveryId },
      { id: deliveryElementId(deliveryId, attemptCount, transitionVersion) }
    )
  );

/**
 * Best-effort post-commit wake; reconciliation closes any lost-wake window.
 *
 * An intent whose coalescing window has not elapsed is deliberately left alone:
 * reconciliation offers it once the row comes due, so a worker is never handed
 * an element it cannot act on. The element id is bucketed by `scheduledAt` and
 * `updatedAt`, so a later window or a resumed row is a distinct element rather
 * than a de-duplicated no-op.
 */
export const wakeEmailOutbox = (outboxId: string) =>
  Effect.gen(function* () {
    const queues = yield* Effect.serviceOption(EmailOutboxQueues);
    const repository = yield* Effect.serviceOption(EmailOutboxRepository);
    if (Option.isNone(queues) || Option.isNone(repository)) {
      return;
    }
    const intent = yield* repository.value.findById(outboxId);
    if (intent === undefined || intent.state !== "pending") {
      return;
    }
    if (yield* DateTime.isFuture(DateTime.fromDateUnsafe(intent.scheduledAt))) {
      return;
    }
    yield* queues.value.dispatcher.offer(
      { outboxId },
      {
        id: dispatcherElementId({
          id: intent.id,
          scheduledAt: DateTime.fromDateUnsafe(intent.scheduledAt),
          updatedAt: DateTime.fromDateUnsafe(intent.updatedAt),
        }),
      }
    );
  });

/** Logs a failed post-commit wake; reconciliation closes the lost-wake window. */
export const wakeEmailOutboxBestEffort = (
  outboxId: string | undefined,
  organizationId: string
): Effect.Effect<void> =>
  outboxId === undefined
    ? Effect.void
    : wakeEmailOutbox(outboxId).pipe(
        Effect.annotateLogs({ organizationId, outboxId }),
        // Best-effort by contract: a lost wake is closed by the reconciliation
        // sweep, so this must never fail the caller's already-committed write.
        Effect.catchCause((cause) =>
          Effect.logWarning("Email outbox wake failed", cause).pipe(
            Effect.annotateLogs({ organizationId, outboxId })
          )
        )
      );

/** Recover database intents and delivery rows whose best-effort workflow wake was lost. */
export const reconcileEmailOutbox = ({
  staleSendingAfter = Duration.minutes(5),
}: {
  readonly staleSendingAfter?: Duration.Duration;
} = {}): Effect.Effect<
  void,
  never,
  | DatabaseService
  | EmailOutboxConfig
  | EmailOutboxRepository
  | EmailSubscriptionRepository
  | EntitlementPolicy
  | EmailOutboxQueues
> =>
  Effect.gen(function* () {
    const reconciliationNow = yield* DateTime.now;
    // The repositories read and write `timestamp` columns as `Date`; convert
    // the sweep's instant once instead of at every call.
    const reconciliationNowDate = DateTime.toDateUtc(reconciliationNow);
    const repository = yield* EmailOutboxRepository;
    const subscriptions = yield* EmailSubscriptionRepository;
    const policy = yield* EntitlementPolicy;
    const { maxConcurrentSends } = yield* EmailOutboxConfig;
    const pending = yield* repository.findPending({
      before: reconciliationNowDate,
      limit: reconciliationBatchSize,
    });
    const paused = yield* repository.findPausedByPlan({
      before: reconciliationNowDate,
      limit: reconciliationBatchSize,
    });
    yield* repository.expirePausedDeliveries({ now: reconciliationNowDate });
    const subscriptionOrganizations =
      yield* subscriptions.findPlanStateOrganizationIds();
    const resumedPausedDeliveryIds = yield* Effect.forEach(
      [
        ...new Set([
          ...subscriptionOrganizations,
          ...paused.map((intent) => intent.organizationId),
        ]),
      ],
      (organizationId) =>
        Effect.gen(function* () {
          const eligible = yield* policy.mayMaterializeEmailIntent({
            organizationId,
            kind: "changelog.published",
          });
          yield* subscriptions.reconcileSubscriptionPlanStates({
            eligible,
            now: reconciliationNowDate,
            organizationId,
            // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
            // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
          });
          // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
          return eligible
            ? yield* repository.resumePausedDeliveries({
                now: reconciliationNowDate,
                organizationId,
              })
            : ([] as readonly ResumedEmailDelivery[]);
        }),
      { concurrency: maxConcurrentSends }
    );
    // A previously paused dispatcher may already have completed under its
    // deterministic key. Materialize resumed intents directly so that a plan
    // upgrade never depends on replaying a cached workflow result.
    const resumedDeliveryIds = yield* Effect.forEach(
      paused,
      (intent) => materializeEmailIntent(intent.id),
      { concurrency: maxConcurrentSends }
    );
    yield* recordEmailReconciliationRecoveries(
      resumedDeliveryIds.reduce((count, ids) => count + ids.length, 0) +
        resumedPausedDeliveryIds.reduce((count, ids) => count + ids.length, 0)
    );
    const staleSendingBefore = DateTime.toDateUtc(
      DateTime.subtractDuration(reconciliationNow, staleSendingAfter)
    );
    yield* repository.recoverStaleSendingDeliveries({
      before: staleSendingBefore,
    });
    const deliveries = yield* repository.findDueDeliveries({
      before: reconciliationNowDate,
      limit: reconciliationBatchSize,
      staleSendingBefore,
    });
    const oldestQueuedAt = deliveries[0]?.createdAt;
    yield* recordEmailOldestQueuedAge(
      oldestQueuedAt === undefined
        ? 0
        : Duration.toMillis(
            DateTime.distance(
              DateTime.fromDateUnsafe(oldestQueuedAt),
              reconciliationNow
            )
          )
    );
    yield* Effect.forEach(pending, (intent) => wakeEmailOutbox(intent.id), {
      discard: true,
    });
    yield* Effect.forEach(
      deliveries,
      (delivery) =>
        enqueueEmailDelivery(
          delivery.id,
          delivery.attemptCount,
          delivery.transitionVersion
        ),
      { concurrency: maxConcurrentSends, discard: true }
    );
    yield* Effect.forEach(
      resumedDeliveryIds.flat(),
      (deliveryId) => enqueueEmailDelivery(deliveryId, 0, 0),
      { concurrency: maxConcurrentSends, discard: true }
    );
    yield* Effect.forEach(
      resumedPausedDeliveryIds.flat(),
      // `resumePausedDeliveries` returns the version its update just persisted,
      // so the re-offer cannot collide with the completed pause element.
      (delivery) =>
        enqueueEmailDelivery(
          delivery.id,
          delivery.attemptCount,
          delivery.transitionVersion
        ),
      { concurrency: maxConcurrentSends, discard: true }
    );
  }).pipe(
    Effect.catch((error) =>
      Effect.logError("Email outbox reconciliation failed", error)
    )
  );
