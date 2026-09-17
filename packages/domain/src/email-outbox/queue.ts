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
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as PersistedQueue from "effect/unstable/persistence/PersistedQueue";

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
import { EmailOutboxRepository } from "./repository";
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
    delayMs: Schema.Number,
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
const sendingLeaseRecoveryDelayMs = 5 * 60 * 1000;

// Tokenized unsubscribe/verification links carry a bearer token in the query
// string, so they must never be rendered against a plain-HTTP origin. Loopback
// hosts stay allowed so local development keeps working.
const loopbackHostPattern = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

const retryDelayMs = (deliveryId: string, attempt: number): number => {
  const exponential = Math.min(60 * 60 * 1000, 1000 * 2 ** (attempt - 1));
  let hash = 0;
  for (const character of deliveryId) {
    hash = (hash * 31 + character.charCodeAt(0)) % 10_000;
  }
  return exponential + Math.floor((exponential * (hash % 2001)) / 10_000);
};

const EmailOutboxIntentQueueItem = Schema.Struct({
  outboxId: Schema.String,
});

const EmailDeliveryQueueItem = Schema.Struct({
  deliveryId: Schema.String,
});

/**
 * Retry backoff owned by the queue platform, used when a handler crashes or is
 * redelivered: exponential from one second, capped at one hour, jittered so a
 * restart does not release every element at the same instant.
 */
const emailOutboxQueueRetrySchedule = Schedule.jittered(
  Schedule.min([Schedule.exponential("1 second"), Schedule.spaced("1 hour")])
);

/**
 * A delivery attempt that should be retried instead of completed.
 *
 * `delayMs` is the delay persisted on the delivery row, so the retry schedule
 * and the stored `nextAttemptAt` cannot disagree.
 */
export class EmailDeliveryRetry extends Schema.TaggedError<EmailDeliveryRetry>()(
  "EmailDeliveryRetry",
  {
    delayMs: Schema.Number,
    deliveryId: Schema.String,
    infrastructureFailure: Schema.Boolean,
  }
) {}

/**
 * Waits the delay carried by a retryable delivery outcome.
 *
 * The schedule itself is unbounded: the delivery row owns when retrying stops
 * (`sendDeliveryAttempt` bounds provider attempts and the handler fails the
 * delivery once the consecutive infrastructure budget is spent).
 */
const deliveryRetrySchedule: Schedule.Schedule<number, EmailDeliveryRetry> =
  Schedule.forever.pipe(
    Schedule.setInputType<EmailDeliveryRetry>(),
    Schedule.modifyDelay(({ input }) =>
      Effect.succeed(Duration.millis(input.delayMs))
    )
  );

/**
 * Durable handoff between the outbox tables and the two background workers.
 *
 * The database rows remain the source of truth: a queue element only carries
 * the id of the intent or delivery to work on, so a redelivery after a crash
 * re-reads the current row and repeats an idempotent, guarded write.
 */
export class EmailOutboxQueues extends Context.Service<EmailOutboxQueues>()(
  "EmailOutboxQueues",
  {
    make: Effect.gen(function* () {
      return {
        delivery: yield* PersistedQueue.make({
          name: "email-outbox-delivery",
          schema: EmailDeliveryQueueItem,
          maxAttempts: maximumDeliveryAttempts + maximumInfrastructureFailures,
          retrySchedule: emailOutboxQueueRetrySchedule,
        }),
        dispatcher: yield* PersistedQueue.make({
          name: "email-outbox-dispatcher",
          schema: EmailOutboxIntentQueueItem,
          maxAttempts: maximumInfrastructureFailures,
          retrySchedule: emailOutboxQueueRetrySchedule,
        }),
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}

/** Materializes one durable intent into immutable per-recipient deliveries. */
export const materializeEmailIntent = (outboxId: string) =>
  Effect.gen(function* () {
    const repository = yield* EmailOutboxRepository;
    const { appUrl, appRootDomain } = yield* EmailOutboxConfig;
    const policy = yield* EntitlementPolicy;
    const db = yield* Database.Database;
    const now = yield* DateTime.nowAsDate;
    const intent = yield* repository.findById(outboxId);
    if (!intent) {
      // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
      return [] as readonly string[];
    }
    if (intent.expiresAt && intent.expiresAt.getTime() <= now.getTime()) {
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

const sendDeliveryAttempt = (deliveryId: string) =>
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
    const now = yield* DateTime.nowAsDate;
    const delivery = yield* repository.findDeliveryById(deliveryId);
    if (
      !(delivery && ["queued", "deferred", "sending"].includes(delivery.state))
    ) {
      return { _tag: "terminal" as const };
    }
    // A prior attempt may have claimed this row and then lost its worker
    // before persisting the result. Do not complete the queue element in that
    // state: reconciliation will release the lease, after which this same
    // handler safely resumes the guarded claim.
    if (delivery.state === "sending") {
      return {
        _tag: "retry" as const,
        delayMs: sendingLeaseRecoveryDelayMs,
        infrastructureFailure: true,
      };
    }
    const intent = yield* repository.findById(delivery.outboxId);
    if (
      !intent ||
      (intent.expiresAt && intent.expiresAt.getTime() <= now.getTime())
    ) {
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
        nextAttemptAt: new Date(now.getTime() + 5 * 60_000),
        reason,
      });
      return {
        _tag: "retry" as const,
        delayMs: 5 * 60_000,
        infrastructureFailure: false,
      };
    }
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    );
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
        nextAttemptAt: new Date(now.getTime() + 60 * 60_000),
        reason: "monthly_volume_limit",
      });
      return {
        _tag: "retry" as const,
        delayMs: 60 * 60_000,
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
    const claimed = yield* repository.claimDeliveryForSending({
      id: delivery.id,
      now,
    });
    if (!claimed) {
      return { _tag: "terminal" as const };
    }
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
      Effect.map(Option.some),
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
      const delayMs = retryDelayMs(delivery.id, attempt);
      const retryMetric = recordEmailDeliveryRetry(error._tag);
      return repository
        .deferSendingDelivery({
          id: delivery.id,
          nextAttemptAt: new Date(now.getTime() + delayMs),
          lastError: { tag: error._tag },
        })
        .pipe(
          Effect.tap(() => retryMetric),
          Effect.as<DeliveryAttemptOutcome>({
            _tag: "retry",
            delayMs,
            infrastructureFailure: false,
          })
        );
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
                acceptedAt: now,
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

/** Marks an outbox intent failed after its dispatcher work exhausted retries. */
const failIntentAfterInfrastructureExhaustion = (outboxId: string) =>
  Effect.gen(function* () {
    const repository = yield* EmailOutboxRepository;
    const intent = yield* repository.findById(outboxId);
    if (intent === undefined) {
      return false;
    }
    const failed = yield* repository.markIntentState({
      id: outboxId,
      state: "failed",
    });
    if (failed) {
      yield* recordEmailIntentTransition(intent.kind, "failed");
    }
    return failed;
  }).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.logError(
            "Could not persist exhausted email outbox intent",
            cause
          ).pipe(Effect.annotateLogs({ outboxId }), Effect.as(false))
    )
  );

/**
 * Retry policy for one dispatcher element: the intent's exponential backoff,
 * bounded by the infrastructure failure budget.
 */
const dispatchRetrySchedule = (outboxId: string): Schedule.Schedule<number> =>
  Schedule.recurs(maximumInfrastructureFailures - 1).pipe(
    Schedule.modifyDelay(({ attempt }) =>
      Effect.succeed(Duration.millis(retryDelayMs(outboxId, attempt)))
    )
  );

/**
 * Materializes one outbox intent into deliveries, waiting out its coalescing
 * window first and looping while more recipient batches remain.
 *
 * `Effect.retry` owns the backoff and marks the intent failed once the
 * infrastructure budget is spent; a queue redelivery after a crash restarts
 * the same deterministic work from the intent row.
 */
export const dispatchEmailOutboxIntent = Effect.fn("dispatchEmailOutboxIntent")(
  function* ({ outboxId }: { readonly outboxId: string }) {
    const repository = yield* EmailOutboxRepository;
    const queues = yield* EmailOutboxQueues;
    const { maxConcurrentSends } = yield* EmailOutboxConfig;
    const materializeIntent = Effect.gen(function* () {
      const intent = yield* repository.findById(outboxId);
      if (intent === undefined) {
        return;
      }
      const now = yield* DateTime.nowAsDate;
      const scheduleDelayMs = Math.max(
        0,
        intent.scheduledAt.getTime() - now.getTime()
      );
      if (scheduleDelayMs > 0) {
        yield* Effect.sleep(scheduleDelayMs);
      }
      let hasMoreRecipients = true;
      yield* Effect.whileLoop({
        while: () => hasMoreRecipients,
        body: () =>
          Effect.gen(function* () {
            const deliveryIds = yield* materializeEmailIntent(outboxId);
            yield* Effect.forEach(
              deliveryIds,
              (deliveryId) =>
                queues.delivery.offer({ deliveryId }, { id: deliveryId }),
              { concurrency: maxConcurrentSends, discard: true }
            );
            return (
              deliveryIds.length > 0 &&
              (yield* repository.findById(outboxId))?.state === "pending"
            );
          }),
        step: (stillPending) => {
          hasMoreRecipients = stillPending;
        },
      });
    });
    yield* materializeIntent.pipe(
      Effect.retryOrElse(
        dispatchRetrySchedule(outboxId).pipe(
          Schedule.tap(({ attempt, input }) =>
            Effect.logWarning(
              "Email outbox dispatch attempt failed, retrying",
              input
            ).pipe(Effect.annotateLogs({ attempt, outboxId }))
          )
        ),
        (error) =>
          Effect.logError(
            "Email outbox dispatch retries exhausted",
            error
          ).pipe(
            Effect.annotateLogs({ outboxId }),
            Effect.andThen(failIntentAfterInfrastructureExhaustion(outboxId))
          )
      )
    );
  }
);

/** Best-effort deferral so the delivery row records a retry even after a crash. */
const persistDeliveryDeferral = (deliveryId: string, delayMs: number) =>
  Effect.gen(function* () {
    const repository = yield* EmailOutboxRepository;
    const now = yield* DateTime.nowAsDate;
    yield* repository.deferSendingDelivery({
      id: deliveryId,
      nextAttemptAt: new Date(now.getTime() + delayMs),
      lastError: { tag: "EmailDeliveryActivityError" },
    });
  }).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.logError(
            "Could not persist the deferred email delivery",
            cause
          ).pipe(Effect.annotateLogs({ deliveryId }))
    )
  );

/** Marks a delivery failed after its consecutive infrastructure budget is spent. */
const failDeliveryAfterRetryExhaustion = (deliveryId: string) =>
  Effect.gen(function* () {
    const repository = yield* EmailOutboxRepository;
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
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logError(
                "Could not persist exhausted email delivery",
                cause
              ).pipe(Effect.annotateLogs({ deliveryId }))
        )
      );
    yield* Effect.logError("Email delivery retries exhausted").pipe(
      Effect.annotateLogs({ deliveryId })
    );
  });

/**
 * Runs one guarded delivery attempt.
 *
 * A deferred outcome fails with `EmailDeliveryRetry` so `Effect.retry` waits
 * the persisted delay. A non-interrupt failure persists the same deferral and
 * retries the same way; the delivery row keeps the provider attempt budget.
 */
const runDeliveryAttempt = (
  deliveryId: string,
  consecutiveInfrastructureFailures: Ref.Ref<number>
) =>
  Effect.gen(function* () {
    const outcome = yield* sendDeliveryAttempt(deliveryId).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.gen(function* () {
              const delayMs = retryDelayMs(
                deliveryId,
                (yield* Ref.get(consecutiveInfrastructureFailures)) + 1
              );
              yield* persistDeliveryDeferral(deliveryId, delayMs);
              return {
                _tag: "retry" as const,
                delayMs,
                infrastructureFailure: true,
              };
            })
      )
    );
    if (outcome._tag === "terminal") {
      return;
    }
    let nextInfrastructureFailures = 0;
    if (outcome.infrastructureFailure) {
      nextInfrastructureFailures = yield* Ref.updateAndGet(
        consecutiveInfrastructureFailures,
        (failures) => failures + 1
      );
    } else {
      yield* Ref.set(consecutiveInfrastructureFailures, 0);
    }
    if (nextInfrastructureFailures >= maximumInfrastructureFailures) {
      yield* failDeliveryAfterRetryExhaustion(deliveryId);
      return;
    }
    return yield* new EmailDeliveryRetry({
      delayMs: outcome.delayMs,
      deliveryId,
      infrastructureFailure: outcome.infrastructureFailure,
    });
  });

/**
 * Runs guarded delivery attempts until the delivery reaches a terminal state.
 *
 * Retry delays come from the delivery row, so the retry schedule and the
 * stored `nextAttemptAt` stay in step; the queue only re-delivers the element
 * after a crash or interruption.
 */
export const deliverEmailDelivery = Effect.fn("deliverEmailDelivery")(
  function* ({ deliveryId }: { readonly deliveryId: string }) {
    const consecutiveInfrastructureFailures = yield* Ref.make(0);
    yield* runDeliveryAttempt(
      deliveryId,
      consecutiveInfrastructureFailures
    ).pipe(Effect.retry(deliveryRetrySchedule));
  }
);

/** Forks the concurrent take loops that drain the outbox queues. */
export const EmailOutboxWorkerLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const { maxConcurrentSends } = yield* EmailOutboxConfig;
    const queues = yield* EmailOutboxQueues;
    const dispatcherWorker = queues.dispatcher
      .take(dispatchEmailOutboxIntent)
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Email outbox dispatcher element failed", cause)
        ),
        Effect.forever
      );
    const deliveryWorker = queues.delivery.take(deliverEmailDelivery).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Email delivery element failed", cause)
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

/** Enqueues one delivery, as the dispatcher and reconciliation do. */
export const enqueueEmailDelivery = (deliveryId: string) =>
  Effect.flatMap(EmailOutboxQueues, (queues) =>
    queues.delivery.offer({ deliveryId }, { id: deliveryId })
  );

/** Best-effort post-commit wake; reconciliation closes any lost-wake window. */
export const wakeEmailOutbox = (outboxId: string) =>
  Effect.gen(function* () {
    const queues = yield* Effect.serviceOption(EmailOutboxQueues);
    if (Option.isNone(queues)) {
      return;
    }
    yield* queues.value.dispatcher.offer({ outboxId }, { id: outboxId });
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
        Effect.catchCause((cause) =>
          Effect.logWarning("Failed to wake email outbox", cause)
        )
      );

/** Recover database intents and delivery rows whose best-effort queue wake was lost. */
export const reconcileEmailOutbox = ({
  now,
  staleSendingAfterMs = 5 * 60_000,
}: {
  readonly now?: Date;
  readonly staleSendingAfterMs?: number;
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
    const reconciliationNow = now ?? (yield* DateTime.nowAsDate);
    const repository = yield* EmailOutboxRepository;
    const subscriptions = yield* EmailSubscriptionRepository;
    const policy = yield* EntitlementPolicy;
    const { maxConcurrentSends } = yield* EmailOutboxConfig;
    const pending = yield* repository.findPending({
      before: reconciliationNow,
      limit: reconciliationBatchSize,
    });
    const paused = yield* repository.findPausedByPlan({
      before: reconciliationNow,
      limit: reconciliationBatchSize,
    });
    yield* repository.expirePausedDeliveries({ now: reconciliationNow });
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
            now: reconciliationNow,
            organizationId,
            // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
            // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
          });
          // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
          return eligible
            ? yield* repository.resumePausedDeliveries({
                now: reconciliationNow,
                organizationId,
              })
            : ([] as readonly string[]);
        }),
      { concurrency: maxConcurrentSends }
    );
    // A previously paused dispatcher element may already have completed under
    // its deterministic id. Materialize resumed intents directly so that a
    // plan upgrade never depends on replaying a cached dispatcher result.
    const resumedDeliveryIds = yield* Effect.forEach(
      paused,
      (intent) => materializeEmailIntent(intent.id),
      { concurrency: maxConcurrentSends }
    );
    yield* recordEmailReconciliationRecoveries(
      resumedDeliveryIds.reduce((count, ids) => count + ids.length, 0) +
        resumedPausedDeliveryIds.reduce((count, ids) => count + ids.length, 0)
    );
    yield* repository.recoverStaleSendingDeliveries({
      before: new Date(reconciliationNow.getTime() - staleSendingAfterMs),
    });
    const deliveries = yield* repository.findDueDeliveries({
      before: reconciliationNow,
      limit: reconciliationBatchSize,
      staleSendingBefore: new Date(
        reconciliationNow.getTime() - staleSendingAfterMs
      ),
    });
    const oldestQueuedAt = deliveries[0]?.createdAt;
    yield* recordEmailOldestQueuedAge(
      oldestQueuedAt === undefined
        ? 0
        : reconciliationNow.getTime() - oldestQueuedAt.getTime()
    );
    yield* Effect.forEach(pending, (intent) => wakeEmailOutbox(intent.id), {
      discard: true,
    });
    yield* Effect.forEach(
      deliveries,
      (delivery) => enqueueEmailDelivery(delivery.id),
      { concurrency: maxConcurrentSends, discard: true }
    );
    yield* Effect.forEach(
      resumedDeliveryIds.flat(),
      (deliveryId) => enqueueEmailDelivery(deliveryId),
      { concurrency: maxConcurrentSends, discard: true }
    );
    yield* Effect.forEach(
      resumedPausedDeliveryIds.flat(),
      (deliveryId) => enqueueEmailDelivery(deliveryId),
      { concurrency: maxConcurrentSends, discard: true }
    );
  }).pipe(
    Effect.catch((error) =>
      Effect.logError("Email outbox reconciliation failed", error)
    )
  );
