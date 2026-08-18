import { Database, schema, transaction } from "@feeblo/db";
import type { Database as DatabaseService } from "@feeblo/db/database";
import {
  Mailer,
  MailPermanentDeliveryError,
  MailTemplateRenderError,
  MailTemporaryDeliveryError,
  MailUncertainDeliveryError,
} from "@feeblo/transactional/mailer";
import { createEmailSubscriptionVerificationEmail } from "@feeblo/transactional/templates/email-subscription-verification";
import { createNotificationEmail } from "@feeblo/transactional/templates/notification";
import { and, eq, gte, isNull, sum } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as W from "effect/unstable/workflow";
import * as WorkflowEngine from "effect/unstable/workflow/WorkflowEngine";

import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import { EmailOutboxConfig } from "./config";
import {
  emailSubscriptionTopicForIntent,
  makeSubmissionNotificationPayload,
  resolveSubscriptionNotificationContent,
} from "./content";
import { EmailOutboxDataError, EmailOutboxRepository } from "./repository";
import {
  NotificationTemplatePayload,
  SubscriptionVerificationTemplatePayload,
} from "./schema";
import {
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

const retryDelayMs = (deliveryId: string, attempt: number): number => {
  const exponential = Math.min(60 * 60 * 1000, 1000 * 2 ** (attempt - 1));
  let hash = 0;
  for (const character of deliveryId) {
    hash = (hash * 31 + character.charCodeAt(0)) % 10_000;
  }
  return exponential + Math.floor((exponential * (hash % 2001)) / 10_000);
};

const workflowError = Schema.Union([
  EmailOutboxDataError,
  MailPermanentDeliveryError,
  MailTemplateRenderError,
  MailTemporaryDeliveryError,
  MailUncertainDeliveryError,
]);

export const EmailOutboxDispatcherWorkflow = W.Workflow.make(
  "EmailOutboxDispatcherWorkflow",
  {
    payload: { outboxId: Schema.String },
    error: workflowError,
    idempotencyKey: ({ outboxId }) => outboxId,
  }
);

export const EmailDeliveryWorkflow = W.Workflow.make("EmailDeliveryWorkflow", {
  payload: { deliveryId: Schema.String },
  error: workflowError,
  idempotencyKey: ({ deliveryId }) => deliveryId,
});

/** Materializes one durable intent into immutable per-recipient deliveries. */
export const materializeEmailIntent = (outboxId: string) =>
  Effect.gen(function* () {
    const repository = yield* EmailOutboxRepository;
    const { appUrl } = yield* EmailOutboxConfig;
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
      intent
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
    const recipients = yield* db
      .select({
        contactId: schema.emailContactTable.id,
        email: schema.emailContactTable.email,
        subscriptionId: schema.emailSubscriptionTable.id,
      })
      .from(schema.emailSubscriptionTable)
      .innerJoin(
        schema.emailContactTable,
        eq(schema.emailContactTable.id, schema.emailSubscriptionTable.contactId)
      )
      .leftJoin(
        schema.emailSuppressionTable,
        eq(schema.emailSuppressionTable.email, schema.emailContactTable.email)
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
          eq(schema.emailSubscriptionTable.topicType, content.topic.topicType),
          content.topic.topicId === null
            ? isNull(schema.emailSubscriptionTable.topicId)
            : eq(schema.emailSubscriptionTable.topicId, content.topic.topicId),
          eq(schema.emailSubscriptionTable.state, "active"),
          eq(schema.emailContactTable.verificationState, "verified"),
          isNull(schema.emailSuppressionTable.email),
          isNull(schema.emailDeliveryTable.id)
        )
      )
      .orderBy(schema.emailSubscriptionTable.id)
      .limit(materializationBatchSize);

    return yield* transaction(
      Effect.gen(function* () {
        const created = yield* Effect.forEach(recipients, (recipient) => {
          // Persist only the subscription ID. The purpose-bound bearer token
          // is derived immediately before send and remains hash-only at rest.
          return repository.createDelivery({
            outboxId: intent.id,
            contactId: recipient.contactId,
            recipientEmail: recipient.email,
            template: "subscription-notification",
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
    const now = yield* DateTime.nowAsDate;
    const delivery = yield* repository.findDeliveryById(deliveryId);
    if (
      !(delivery && ["queued", "deferred", "sending"].includes(delivery.state))
    ) {
      return { _tag: "terminal" as const };
    }
    // A prior activity may have claimed this row and then lost its worker
    // before persisting the result. Do not complete the deterministic workflow
    // in that state: reconciliation will release the lease, after which this
    // same workflow execution safely resumes the guarded claim.
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
    const claimed = yield* repository.claimDeliveryForSending({
      id: delivery.id,
      now,
    });
    if (!claimed) {
      return { _tag: "terminal" as const };
    }
    const mailMessage = yield* Effect.gen(function* () {
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
        const verificationUrl = `${apiUrl}/api/email-subscriptions/verify?token=${encodeURIComponent(Redacted.value(token))}`;
        return createEmailSubscriptionVerificationEmail({ verificationUrl });
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
      if (payload.unsubscribe.kind === "settings") {
        return createNotificationEmail({
          ...payload,
          unsubscribeUrl: payload.unsubscribe.url,
        });
      }
      const token = yield* subscriptions.deriveLinkToken({
        purpose: "unsubscribe",
        subscriptionId: payload.unsubscribe.subscriptionId,
      });
      const unsubscribeUrl = `${apiUrl}/api/email-subscriptions/unsubscribe?token=${encodeURIComponent(Redacted.value(token))}`;
      return {
        ...createNotificationEmail({ ...payload, unsubscribeUrl }),
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
    });
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
    const sent = yield* mailer
      .send({
        ...mailMessage,
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

export const EmailOutboxWorkflowLayer = Layer.mergeAll(
  EmailOutboxDispatcherWorkflow.toLayer(
    Effect.fnUntraced(function* ({ outboxId }) {
      const { maxConcurrentSends } = yield* EmailOutboxConfig;
      let dispatch: (
        attempt: number,
        infrastructureFailures: number
      ) => Effect.Effect<
        void,
        never,
        | WorkflowEngine.WorkflowEngine
        | WorkflowEngine.WorkflowInstance
        | EmailOutboxRepository
        | EmailOutboxConfig
        | EntitlementPolicy
        | DatabaseService
      >;
      dispatch = Effect.fnUntraced(function* (
        attempt: number,
        infrastructureFailures: number
      ) {
        const failIntentAfterInfrastructureExhaustion = W.Activity.make({
          name: `FailEmailOutboxIntent-${attempt}`,
          success: Schema.Boolean,
          error: EmailOutboxDataError,
          execute: Effect.gen(function* () {
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
            Effect.mapError(
              () =>
                new EmailOutboxDataError({
                  operation: "fail intent",
                  reason: "Could not mark exhausted email outbox intent failed",
                })
            )
          ),
        }).pipe(
          Effect.catch((error) =>
            Effect.logError(
              "Could not persist exhausted email outbox intent",
              error
            ).pipe(Effect.as(false))
          )
        );
        const delay = yield* W.Activity.make({
          name: `LoadEmailOutboxSchedule-${attempt}`,
          success: Schema.Number,
          error: EmailOutboxDataError,
          execute: Effect.gen(function* () {
            const intent = yield* (yield* EmailOutboxRepository).findById(
              outboxId
            );
            const now = yield* DateTime.nowAsDate;
            return intent
              ? Math.max(0, intent.scheduledAt.getTime() - now.getTime())
              : 0;
          }).pipe(
            Effect.mapError(
              () =>
                new EmailOutboxDataError({
                  operation: "load schedule",
                  reason: "Could not load email outbox intent",
                })
            )
          ),
        }).pipe(Effect.catch(() => Effect.void));
        if (delay === undefined) {
          if (infrastructureFailures + 1 >= maximumInfrastructureFailures) {
            yield* failIntentAfterInfrastructureExhaustion;
            return;
          }
          yield* W.DurableClock.sleep({
            name: `email-outbox-dispatcher-retry-${outboxId}-${attempt}`,
            duration: retryDelayMs(outboxId, attempt),
          });
          return yield* dispatch(attempt + 1, infrastructureFailures + 1);
        }
        if (delay > 0) {
          yield* W.DurableClock.sleep({
            name: `email-outbox-scheduled-${outboxId}`,
            duration: delay,
          });
        }
        const deliveryIds = yield* W.Activity.make({
          name: `MaterializeEmailOutboxIntent-${attempt}`,
          success: Schema.Array(Schema.String),
          error: EmailOutboxDataError,
          execute: materializeEmailIntent(outboxId).pipe(
            Effect.mapError(
              () =>
                new EmailOutboxDataError({
                  operation: "materialize",
                  reason: "Could not materialize email outbox intent",
                })
            )
          ),
        }).pipe(Effect.catch(() => Effect.void));
        if (deliveryIds === undefined) {
          if (infrastructureFailures + 1 >= maximumInfrastructureFailures) {
            yield* failIntentAfterInfrastructureExhaustion;
            return;
          }
          yield* W.DurableClock.sleep({
            name: `email-outbox-dispatcher-retry-${outboxId}-${attempt}`,
            duration: retryDelayMs(outboxId, attempt),
          });
          return yield* dispatch(attempt + 1, infrastructureFailures + 1);
        }
        yield* Effect.forEach(
          deliveryIds,
          (deliveryId) =>
            EmailDeliveryWorkflow.execute({ deliveryId }, { discard: true }),
          { concurrency: maxConcurrentSends, discard: true }
        );
        const hasMoreRecipients = yield* W.Activity.make({
          name: `CheckEmailOutboxMaterialization-${attempt}`,
          success: Schema.Boolean,
          error: EmailOutboxDataError,
          execute: Effect.gen(function* () {
            const intent = yield* (yield* EmailOutboxRepository).findById(
              outboxId
            );
            return intent?.state === "pending";
          }).pipe(
            Effect.mapError(
              () =>
                new EmailOutboxDataError({
                  operation: "check materialization",
                  reason: "Could not inspect email outbox materialization",
                })
            )
          ),
        }).pipe(Effect.catch(() => Effect.void));
        if (hasMoreRecipients === undefined) {
          if (infrastructureFailures + 1 >= maximumInfrastructureFailures) {
            yield* failIntentAfterInfrastructureExhaustion;
            return;
          }
          yield* W.DurableClock.sleep({
            name: `email-outbox-dispatcher-retry-${outboxId}-${attempt}`,
            duration: retryDelayMs(outboxId, attempt),
          });
          return yield* dispatch(attempt + 1, infrastructureFailures + 1);
        }
        if (hasMoreRecipients) {
          return yield* dispatch(attempt + 1, 0);
        }
      });
      yield* dispatch(1, 0);
    })
  ),
  EmailDeliveryWorkflow.toLayer(
    Effect.fnUntraced(function* ({ deliveryId }) {
      const repository = yield* EmailOutboxRepository;
      let run: (
        attempt: number,
        infrastructureFailures: number
      ) => Effect.Effect<
        void,
        never,
        | WorkflowEngine.WorkflowEngine
        | WorkflowEngine.WorkflowInstance
        | EmailOutboxRepository
        | EntitlementPolicy
        | DatabaseService
        | Mailer
        | EmailOutboxConfig
        | EmailSubscriptionRepository
      >;
      run = Effect.fnUntraced(function* (
        attempt: number,
        infrastructureFailures: number
      ) {
        const outcome = yield* W.Activity.make({
          name: `SendEmailDelivery-${attempt}`,
          success: DeliveryAttemptOutcomeSchema,
          error: workflowError,
          execute: sendDeliveryAttempt(deliveryId).pipe(
            // Preserve repository-level typed failures; only the residual
            // infrastructure channel (SqlError and other untyped drivers)
            // collapses into the activity's EmailOutboxDataError envelope.
            Effect.catchTags({
              EmailOutboxDataError: (error) => Effect.fail(error),
            }),
            Effect.mapError(
              () =>
                new EmailOutboxDataError({
                  operation: "deliver",
                  reason: "Could not process email delivery",
                })
            )
          ),
        }).pipe(
          // Database and workflow activity infrastructure failures leave the
          // delivery non-terminal; retry through the durable timer instead of
          // completing this deterministic workflow with a cached failure.
          Effect.catch(() => {
            const delayMs = retryDelayMs(deliveryId, attempt);
            const retryOutcome = {
              _tag: "retry" as const,
              delayMs,
              infrastructureFailure: true,
            };
            return W.Activity.make({
              name: `DeferEmailDeliveryInfrastructure-${attempt}`,
              success: DeliveryAttemptOutcomeSchema,
              error: EmailOutboxDataError,
              execute: Effect.gen(function* () {
                const now = yield* DateTime.nowAsDate;
                yield* repository.deferSendingDelivery({
                  id: deliveryId,
                  nextAttemptAt: new Date(now.getTime() + delayMs),
                  lastError: { tag: "EmailDeliveryActivityError" },
                });
                return retryOutcome;
              }).pipe(
                Effect.mapError(
                  () =>
                    new EmailOutboxDataError({
                      operation: "defer delivery after infrastructure failure",
                      reason: "Could not persist the deferred delivery",
                    })
                )
              ),
            }).pipe(Effect.catch(() => Effect.succeed(retryOutcome)));
          })
        );
        if (outcome._tag === "terminal") {
          return;
        }
        const nextInfrastructureFailures = outcome.infrastructureFailure
          ? infrastructureFailures + 1
          : 0;
        if (nextInfrastructureFailures >= maximumInfrastructureFailures) {
          yield* W.Activity.make({
            name: `FailEmailDeliveryInfrastructure-${attempt}`,
            success: Schema.Boolean,
            error: EmailOutboxDataError,
            execute: repository
              .markDeliveryOutcome({
                id: deliveryId,
                state: "failed",
                lastError: {
                  tag: "EmailDeliveryInfrastructureFailure",
                  reason: "retry_exhausted",
                },
              })
              .pipe(
                Effect.mapError(
                  () =>
                    new EmailOutboxDataError({
                      operation: "fail delivery",
                      reason: "Could not mark exhausted email delivery failed",
                    })
                )
              ),
          }).pipe(
            Effect.catch((error) =>
              Effect.logError(
                "Could not persist exhausted email delivery",
                error
              ).pipe(Effect.as(false))
            )
          );
          return;
        }
        yield* W.DurableClock.sleep({
          name: `email-delivery-retry-${deliveryId}-${attempt}`,
          duration: outcome.delayMs,
        });
        yield* run(attempt + 1, nextInfrastructureFailures);
      });
      yield* run(1, 0);
    })
  )
);

/** Best-effort post-commit wake; reconciliation closes any lost-wake window. */
export const wakeEmailOutbox = (outboxId: string) =>
  Effect.gen(function* () {
    const engine = yield* Effect.serviceOption(WorkflowEngine.WorkflowEngine);
    if (Option.isNone(engine)) {
      return;
    }
    yield* EmailOutboxDispatcherWorkflow.execute(
      { outboxId },
      { discard: true }
    ).pipe(Effect.provideService(WorkflowEngine.WorkflowEngine, engine.value));
  });

/** Logs a failed post-commit wake; reconciliation closes the lost-wake window. */
export const wakeEmailOutboxBestEffort = (
  outboxId: string | undefined,
  organizationId: string
): Effect.Effect<void> =>
  outboxId === undefined
    ? Effect.void
    : wakeEmailOutbox(outboxId).pipe(
        Effect.annotateLogs({ organizationId, outboxId })
      );

/** Recover database intents and delivery rows whose best-effort workflow wake was lost. */
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
  | WorkflowEngine.WorkflowEngine
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
      (delivery) =>
        EmailDeliveryWorkflow.execute(
          { deliveryId: delivery.id },
          { discard: true }
        ),
      { concurrency: maxConcurrentSends, discard: true }
    );
    yield* Effect.forEach(
      resumedDeliveryIds.flat(),
      (deliveryId) =>
        EmailDeliveryWorkflow.execute({ deliveryId }, { discard: true }),
      { concurrency: maxConcurrentSends, discard: true }
    );
    yield* Effect.forEach(
      resumedPausedDeliveryIds.flat(),
      (deliveryId) =>
        EmailDeliveryWorkflow.execute({ deliveryId }, { discard: true }),
      { concurrency: maxConcurrentSends, discard: true }
    );
  }).pipe(
    Effect.catch((error) =>
      Effect.logError("Email outbox reconciliation failed", error)
    )
  );
