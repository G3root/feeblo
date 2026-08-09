import { Database, schema, transaction } from "@feeblo/db";
import type { Database as DatabaseService } from "@feeblo/db/database";
import {
  Mailer,
  MailPermanentDeliveryError,
  MailTemplateRenderError,
  MailTemporaryDeliveryError,
  MailUncertainDeliveryError,
} from "@feeblo/transactional/mailer";
import { createNotificationEmail } from "@feeblo/transactional/templates/notification";
import { and, eq, isNull } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as W from "effect/unstable/workflow";
import * as WorkflowEngine from "effect/unstable/workflow/WorkflowEngine";
import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import { EmailOutboxConfig } from "./config";
import { EmailOutboxDataError, EmailOutboxRepository } from "./repository";
import {
  type EmailIntentPayload,
  type NotificationTemplatePayload as NotificationPayload,
  NotificationTemplatePayload,
} from "./schema";
import {
  recordEmailIntentTransition,
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

type NotificationContent = {
  readonly templatePayload: Omit<NotificationPayload, "unsubscribeUrl">;
  readonly topic: {
    readonly topicId: string | null;
    readonly topicType: "changelog" | "post";
  };
};

const submissionPayload = (
  appUrl: string,
  organizationId: string,
  post: {
    readonly slug: string;
    readonly title: string;
    readonly board: { readonly slug: string } | null;
  }
): NotificationPayload => ({
  actionLabel: "View dashboard",
  actionUrl: appUrl,
  body: "A new post has been submitted.",
  eyebrow: "Feedback",
  posts: [
    {
      label: post.title,
      url: `${appUrl}/${organizationId}/post/${post.board?.slug ?? ""}/${post.slug}`,
    },
  ],
  title: "New submission in your workspace",
  // Email-contact subscription management lands in a later slice. The current
  // workspace settings endpoint is the only safe product URL available here.
  unsubscribeUrl: `${appUrl}/settings/notifications`,
});

const titleCase = (value: string): string =>
  value
    .toLowerCase()
    .split("_")
    .map((part) =>
      part.length === 0 ? part : `${part[0]?.toUpperCase()}${part.slice(1)}`
    )
    .join(" ");

const subscriptionTopicForIntent = (payload: EmailIntentPayload) => {
  switch (payload.kind) {
    case "changelog.published":
    case "changelog.update_requested":
      return { topicId: null, topicType: "changelog" as const };
    case "post.status_changed":
    case "post.merged":
    case "post.closed":
      return { topicId: payload.postId, topicType: "post" as const };
    default:
      return undefined;
  }
};

const subscriptionNotificationContent = (
  appUrl: string,
  intent: {
    readonly organizationId: string;
    readonly payload: EmailIntentPayload;
  }
) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;
    switch (intent.payload.kind) {
      case "changelog.published":
      case "changelog.update_requested": {
        const changelog = yield* db.query.changelogTable.findFirst({
          where: {
            id: intent.payload.changelogId,
            organizationId: intent.organizationId,
          },
          columns: { excerpt: true, slug: true, title: true },
        });
        if (!changelog) {
          return undefined;
        }
        const published = intent.payload.kind === "changelog.published";
        return {
          topic: { topicType: "changelog" as const, topicId: null },
          templatePayload: {
            actionLabel: "View changelog",
            actionUrl: `${appUrl}/${intent.organizationId}/changelog`,
            body:
              changelog.excerpt ||
              (published
                ? "A new changelog entry has been published."
                : "A changelog update is available."),
            eyebrow: "Changelog",
            posts: [
              {
                label: changelog.title,
                url: `${appUrl}/${intent.organizationId}/changelog`,
              },
            ],
            title: `${published ? "New changelog" : "Changelog update"}: ${changelog.title}`,
          },
        } satisfies NotificationContent;
      }
      case "post.status_changed":
      case "post.merged":
      case "post.closed": {
        const post = yield* db.query.postTable.findFirst({
          where: {
            id: intent.payload.postId,
            organizationId: intent.organizationId,
          },
          columns: { slug: true, title: true },
          with: {
            board: { columns: { slug: true } },
            postStatus: { columns: { type: true } },
          },
        });
        if (!post) {
          return undefined;
        }
        const url = `${appUrl}/${intent.organizationId}/post/${post.board?.slug ?? ""}/${post.slug}`;
        let event = `moved to ${titleCase(post.postStatus?.type ?? "updated")}`;
        if (intent.payload.kind === "post.merged") {
          event = "merged";
        } else if (intent.payload.kind === "post.closed") {
          event = "closed";
        }
        return {
          topic: { topicType: "post" as const, topicId: intent.payload.postId },
          templatePayload: {
            actionLabel: "View post",
            actionUrl: url,
            body: `A post you follow was ${event}.`,
            eyebrow: "Feedback",
            posts: [{ label: post.title, url }],
            title: `Post ${event}: ${post.title}`,
          },
        } satisfies NotificationContent;
      }
      default:
        return undefined;
    }
  });

const materializeSubmission = (outboxId: string) =>
  Effect.gen(function* () {
    const repository = yield* EmailOutboxRepository;
    const { appUrl } = yield* EmailOutboxConfig;
    const policy = yield* EntitlementPolicy;
    const db = yield* Database.Database;
    const intent = yield* repository.findById(outboxId);
    if (!intent) {
      return [] as readonly string[];
    }
    if (intent.expiresAt && intent.expiresAt.getTime() <= Date.now()) {
      yield* repository.markIntentState({ id: intent.id, state: "expired" });
      yield* recordEmailIntentTransition(intent.kind, "expired");
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
      }
      return [] as readonly string[];
    }
    if (intent.state === "paused_by_plan") {
      if (!(yield* repository.resumePausedIntent({ id: intent.id }))) {
        return [] as readonly string[];
      }
    } else if (intent.state !== "pending") {
      return [] as readonly string[];
    }
    if (intent.payload.kind === "post.official_update_published") {
      yield* repository.markIntentState({ id: intent.id, state: "failed" });
      yield* recordEmailIntentTransition(intent.kind, "failed");
      return [] as readonly string[];
    }

    if (intent.payload.kind === "submission.created") {
      const post = yield* db.query.postTable.findFirst({
        where: {
          id: intent.payload.postId,
          organizationId: intent.organizationId,
        },
        columns: { slug: true, title: true },
        with: { board: { columns: { slug: true } } },
      });
      if (!post) {
        yield* repository.markIntentState({ id: intent.id, state: "expired" });
        yield* recordEmailIntentTransition(intent.kind, "expired");
        return [] as readonly string[];
      }

      const recipientLimit = yield* policy.submissionNotificationRecipientLimit(
        intent.organizationId
      );
      const members = yield* db.query.memberTable.findMany({
        where: { organizationId: intent.organizationId },
        columns: { role: true },
        with: { user: { columns: { email: true } } },
      });
      // There is no configured free-recipient or administrator email opt-in
      // storage yet. Until slices 5/7 add them, the owner is the free default;
      // paid workspaces include owner/admin accounts only.
      const recipients = members
        .filter((member) =>
          recipientLimit === 1
            ? member.role === "owner"
            : member.role === "owner" || member.role === "admin"
        )
        .flatMap((member) => (member.user?.email ? [member.user.email] : []))
        .slice(0, recipientLimit ?? undefined);
      const templatePayload = submissionPayload(
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

    const content = yield* subscriptionNotificationContent(appUrl, intent);
    if (!content) {
      yield* repository.markIntentState({ id: intent.id, state: "expired" });
      yield* recordEmailIntentTransition(intent.kind, "expired");
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
          // A bearer unsubscribe token cannot be kept in delivery JSON: that
          // data is retained for retries and would violate hash-only storage.
          // The existing product has no token-safe one-click endpoint, so use
          // the settings URL until that lifecycle seam is added.
          return repository.createDelivery({
            outboxId: intent.id,
            contactId: recipient.contactId,
            recipientEmail: recipient.email,
            template: "subscription-notification",
            templateVersion: 1,
            templatePayload: {
              ...content.templatePayload,
              unsubscribeUrl: `${appUrl}/settings/notifications`,
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
  deliveryId: string
): Effect.Effect<
  DeliveryAttemptOutcome,
  unknown,
  DatabaseService | EmailOutboxRepository | EntitlementPolicy | Mailer
> =>
  Effect.gen(function* () {
    const repository = yield* EmailOutboxRepository;
    const policy = yield* EntitlementPolicy;
    const db = yield* Database.Database;
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
      (intent.expiresAt && intent.expiresAt.getTime() <= Date.now())
    ) {
      yield* repository.markDeliveryOutcome({
        id: delivery.id,
        state: "expired",
      });
      return { _tag: "terminal" as const };
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
    if (delivery.contactId !== null) {
      const topic = subscriptionTopicForIntent(intent.payload);
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
      now: new Date(),
    });
    if (!claimed) {
      return { _tag: "terminal" as const };
    }
    const payload = yield* Schema.decodeUnknownEffect(
      NotificationTemplatePayload
    )(delivery.templatePayload).pipe(
      Effect.mapError(() => new MailTemplateRenderError({}))
    );
    const mailer = yield* Mailer;
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
      return repository
        .markDeliveryDeferred({
          id: delivery.id,
          nextAttemptAt: new Date(Date.now() + delayMs),
          lastError: { tag: error._tag },
        })
        .pipe(
          Effect.as<DeliveryAttemptOutcome>({
            _tag: "retry",
            delayMs,
            infrastructureFailure: false,
          })
        );
    };
    const sent = yield* mailer
      .send({
        ...createNotificationEmail(payload),
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
          MailUncertainDeliveryError: deferAfterRetryableProviderFailure,
        }),
        Effect.flatMap((result) => {
          if (result._tag !== "accepted") {
            return Effect.succeed(result);
          }
          if (result.accepted) {
            return repository
              .markDeliveryAccepted({
                id: delivery.id,
                acceptedAt: new Date(),
                providerMetadata: result.providerMetadata,
              })
              .pipe(Effect.as<DeliveryAttemptOutcome>({ _tag: "terminal" }));
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
          return deferAfterRetryableProviderFailure(
            new MailUncertainDeliveryError({})
          );
        })
      );
    return sent;
  });

export const EmailOutboxWorkflowLayer = Layer.mergeAll(
  EmailOutboxDispatcherWorkflow.toLayer(
    Effect.fnUntraced(function* ({ outboxId }) {
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
            return intent
              ? Math.max(0, intent.scheduledAt.getTime() - Date.now())
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
          execute: materializeSubmission(outboxId).pipe(
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
          { discard: true }
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
            return repository
              .releaseSendingDelivery({
                id: deliveryId,
                nextAttemptAt: new Date(Date.now() + delayMs),
                lastError: { tag: "EmailDeliveryActivityError" },
              })
              .pipe(
                Effect.catch(() => Effect.void),
                Effect.as({
                  _tag: "retry" as const,
                  delayMs,
                  infrastructureFailure: true,
                })
              );
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

/** Recover database intents and delivery rows whose best-effort workflow wake was lost. */
export const reconcileEmailOutbox = ({
  now = new Date(),
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
    const repository = yield* EmailOutboxRepository;
    const subscriptions = yield* EmailSubscriptionRepository;
    const policy = yield* EntitlementPolicy;
    const pending = yield* repository.findPending({
      before: now,
      limit: reconciliationBatchSize,
    });
    const paused = yield* repository.findPausedByPlan({
      before: now,
      limit: reconciliationBatchSize,
    });
    yield* repository.expirePausedDeliveries({ now });
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
            now,
            organizationId,
          });
          return eligible
            ? yield* repository.resumePausedDeliveries({ now, organizationId })
            : ([] as readonly string[]);
        }),
      { concurrency: 10 }
    );
    // A previously paused dispatcher may already have completed under its
    // deterministic key. Materialize resumed intents directly so that a plan
    // upgrade never depends on replaying a cached workflow result.
    const resumedDeliveryIds = yield* Effect.forEach(
      paused,
      (intent) => materializeSubmission(intent.id),
      { concurrency: 10 }
    );
    yield* recordEmailReconciliationRecoveries(
      resumedDeliveryIds.reduce((count, ids) => count + ids.length, 0) +
        resumedPausedDeliveryIds.reduce((count, ids) => count + ids.length, 0)
    );
    const intents = pending;
    yield* repository.recoverStaleSendingDeliveries({
      before: new Date(now.getTime() - staleSendingAfterMs),
    });
    const deliveries = yield* repository.findDueDeliveries({
      before: now,
      limit: reconciliationBatchSize,
      staleSendingBefore: new Date(now.getTime() - staleSendingAfterMs),
    });
    yield* Effect.forEach(intents, (intent) => wakeEmailOutbox(intent.id), {
      discard: true,
    });
    yield* Effect.forEach(
      deliveries,
      (delivery) =>
        EmailDeliveryWorkflow.execute(
          { deliveryId: delivery.id },
          { discard: true }
        ),
      { discard: true }
    );
    yield* Effect.forEach(
      resumedDeliveryIds.flat(),
      (deliveryId) =>
        EmailDeliveryWorkflow.execute({ deliveryId }, { discard: true }),
      { discard: true }
    );
    yield* Effect.forEach(
      resumedPausedDeliveryIds.flat(),
      (deliveryId) =>
        EmailDeliveryWorkflow.execute({ deliveryId }, { discard: true }),
      { discard: true }
    );
  }).pipe(
    Effect.catch((error) =>
      Effect.logError("Email outbox reconciliation failed", error)
    )
  );
