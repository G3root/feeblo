import { Database, schema, transaction } from "@feeblo/db";
import type { Database as DatabaseService } from "@feeblo/db/database";
import { EntitlementPolicy } from "../entitlement/policies";
import { EmailSubscriptionRepository } from "../email-subscription/repository";
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
import * as WorkflowEngine from "effect/unstable/workflow/WorkflowEngine";
import * as W from "effect/unstable/workflow";
import { EmailOutboxDataError, EmailOutboxRepository } from "./repository";
import {
  NotificationTemplatePayload,
  type EmailIntentPayload,
  type NotificationTemplatePayload as NotificationPayload,
} from "./schema";
import {
  recordEmailIntentTransition,
  recordEmailReconciliationRecoveries,
} from "./telemetry";

const DeliveryAttemptOutcomeSchema = Schema.TaggedUnion({
  retry: { delayMs: Schema.Number },
  terminal: {},
});

type DeliveryAttemptOutcome = Schema.Schema.Type<typeof DeliveryAttemptOutcomeSchema>;

const maximumDeliveryAttempts = 5;
const sendingLeaseRecoveryDelayMs = 5 * 60 * 1_000;

const retryDelayMs = (deliveryId: string, attempt: number): number => {
  const exponential = Math.min(60 * 60 * 1000, 1_000 * 2 ** (attempt - 1));
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
  organizationId: string,
  post: { readonly slug: string; readonly title: string; readonly board: { readonly slug: string } | null }
): NotificationPayload => ({
  actionLabel: "View dashboard",
  actionUrl: "https://app.feeblo.com",
  body: "A new post has been submitted.",
  eyebrow: "Feedback",
  posts: [{
    label: post.title,
    url: `https://app.feeblo.com/${organizationId}/post/${post.board?.slug ?? ""}/${post.slug}`,
  }],
  title: "New submission in your workspace",
  // Email-contact subscription management lands in a later slice. The current
  // workspace settings endpoint is the only safe product URL available here.
  unsubscribeUrl: "https://app.feeblo.com/settings/notifications",
});

const titleCase = (value: string): string =>
  value.toLowerCase().split("_").map((part) =>
    part.length === 0 ? part : `${part[0]?.toUpperCase()}${part.slice(1)}`
  ).join(" ");

const subscriptionUnsubscribeUrl = "https://app.feeblo.com/settings/notifications";

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

const subscriptionNotificationContent = (intent: {
  readonly organizationId: string;
  readonly payload: EmailIntentPayload;
}) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;
    switch (intent.payload.kind) {
      case "changelog.published":
      case "changelog.update_requested": {
        const changelog = yield* db.query.changelogTable.findFirst({
          where: { id: intent.payload.changelogId, organizationId: intent.organizationId },
          columns: { excerpt: true, slug: true, title: true },
        });
        if (!changelog) return undefined;
        const published = intent.payload.kind === "changelog.published";
        return {
          topic: { topicType: "changelog" as const, topicId: null },
          templatePayload: {
            actionLabel: "View changelog",
            actionUrl: `https://app.feeblo.com/${intent.organizationId}/changelog`,
            body: changelog.excerpt || (published ? "A new changelog entry has been published." : "A changelog update is available."),
            eyebrow: "Changelog",
            posts: [{ label: changelog.title, url: `https://app.feeblo.com/${intent.organizationId}/changelog` }],
            title: `${published ? "New changelog" : "Changelog update"}: ${changelog.title}`,
          },
        } satisfies NotificationContent;
      }
      case "post.status_changed":
      case "post.merged":
      case "post.closed": {
        const post = yield* db.query.postTable.findFirst({
          where: { id: intent.payload.postId, organizationId: intent.organizationId },
          columns: { slug: true, title: true },
          with: {
            board: { columns: { slug: true } },
            postStatus: { columns: { type: true } },
          },
        });
        if (!post) return undefined;
        const url = `https://app.feeblo.com/${intent.organizationId}/post/${post.board?.slug ?? ""}/${post.slug}`;
        const event = intent.payload.kind === "post.merged"
          ? "merged"
          : intent.payload.kind === "post.closed"
            ? "closed"
            : `moved to ${titleCase(post.postStatus?.type ?? "updated")}`;
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
    const policy = yield* EntitlementPolicy;
    const db = yield* Database.Database;
    const intent = yield* repository.findById(outboxId);
    if (!intent) return [] as readonly string[];
    if (intent.expiresAt && intent.expiresAt.getTime() <= Date.now()) {
      yield* repository.markIntentState({ id: intent.id, state: "expired" });
      yield* recordEmailIntentTransition(intent.kind, "expired");
      return [] as readonly string[];
    }
    const eligible = yield* policy.mayMaterializeEmailIntent({ organizationId: intent.organizationId, kind: intent.kind });
    if (!eligible) {
      if (intent.state === "pending") {
        yield* repository.markIntentState({ id: intent.id, state: "paused_by_plan" });
        yield* recordEmailIntentTransition(intent.kind, "paused_by_plan");
      }
      return [] as readonly string[];
    }
    if (intent.state === "paused_by_plan") {
      if (!(yield* repository.resumePausedIntent({ id: intent.id }))) return [] as readonly string[];
    } else if (intent.state !== "pending") return [] as readonly string[];
    if (intent.payload.kind === "post.official_update_published") {
      yield* repository.markIntentState({ id: intent.id, state: "paused_by_plan" });
      yield* recordEmailIntentTransition(intent.kind, "paused_by_plan");
      return [] as readonly string[];
    }

    if (intent.payload.kind === "submission.created") {
      const post = yield* db.query.postTable.findFirst({
        where: { id: intent.payload.postId, organizationId: intent.organizationId },
        columns: { slug: true, title: true },
        with: { board: { columns: { slug: true } } },
      });
      if (!post) {
        yield* repository.markIntentState({ id: intent.id, state: "expired" });
        yield* recordEmailIntentTransition(intent.kind, "expired");
        return [] as readonly string[];
      }

      const recipientLimit = yield* policy.submissionNotificationRecipientLimit(intent.organizationId);
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
          recipientLimit === 1 ? member.role === "owner" : member.role === "owner" || member.role === "admin"
        )
        .flatMap((member) => member.user?.email ? [member.user.email] : [])
        .slice(0, recipientLimit ?? undefined);
      const templatePayload = submissionPayload(intent.organizationId, post);

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
          yield* repository.markIntentState({ id: intent.id, state: "materialized" });
          yield* recordEmailIntentTransition(intent.kind, "materialized");
          return created.flatMap((result) => result._tag === "Inserted" ? [result.delivery.id] : []);
        })
      );
    }

    const content = yield* subscriptionNotificationContent(intent);
    if (!content) {
      yield* repository.markIntentState({ id: intent.id, state: "expired" });
      yield* recordEmailIntentTransition(intent.kind, "expired");
      return [] as readonly string[];
    }
    const recipients = yield* db.select({
      contactId: schema.emailContactTable.id,
      email: schema.emailContactTable.email,
      subscriptionId: schema.emailSubscriptionTable.id,
    }).from(schema.emailSubscriptionTable)
      .innerJoin(schema.emailContactTable, eq(schema.emailContactTable.id, schema.emailSubscriptionTable.contactId))
      .leftJoin(schema.emailSuppressionTable, eq(schema.emailSuppressionTable.email, schema.emailContactTable.email))
      .where(and(
        eq(schema.emailSubscriptionTable.organizationId, intent.organizationId),
        eq(schema.emailSubscriptionTable.topicType, content.topic.topicType),
        content.topic.topicId === null
          ? isNull(schema.emailSubscriptionTable.topicId)
          : eq(schema.emailSubscriptionTable.topicId, content.topic.topicId),
        eq(schema.emailSubscriptionTable.state, "active"),
        eq(schema.emailContactTable.verificationState, "verified"),
        isNull(schema.emailSuppressionTable.email),
      ));

    return yield* transaction(Effect.gen(function* () {
      const created = yield* Effect.forEach(recipients, (recipient) => Effect.gen(function* () {
        // A bearer unsubscribe token cannot be kept in delivery JSON: that
        // data is retained for retries and would violate hash-only storage.
        // The existing product has no token-safe one-click endpoint, so use
        // the settings URL until that lifecycle seam is added.
        return yield* repository.createDelivery({
          outboxId: intent.id,
          contactId: recipient.contactId,
          recipientEmail: recipient.email,
          template: "subscription-notification",
          templateVersion: 1,
          templatePayload: {
            ...content.templatePayload,
            unsubscribeUrl: subscriptionUnsubscribeUrl,
          },
        });
        })
      );
      yield* repository.markIntentState({ id: intent.id, state: "materialized" });
      yield* recordEmailIntentTransition(intent.kind, "materialized");
      return created.flatMap((result) => result?._tag === "Inserted" ? [result.delivery.id] : []);
    }));
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
    if (!delivery || !["queued", "deferred", "sending"].includes(delivery.state)) {
      return { _tag: "terminal" as const };
    }
    // A prior activity may have claimed this row and then lost its worker
    // before persisting the result. Do not complete the deterministic workflow
    // in that state: reconciliation will release the lease, after which this
    // same workflow execution safely resumes the guarded claim.
    if (delivery.state === "sending") {
      return { _tag: "retry" as const, delayMs: sendingLeaseRecoveryDelayMs };
    }
    const intent = yield* repository.findById(delivery.outboxId);
    if (!intent || (intent.expiresAt && intent.expiresAt.getTime() <= Date.now())) {
      yield* repository.markDeliveryTerminal({ id: delivery.id, state: "expired" });
      return { _tag: "terminal" as const };
    }
    if (!(yield* policy.mayMaterializeEmailIntent({
      organizationId: intent.organizationId,
      kind: intent.kind,
    }))) {
      yield* repository.markDeliveryTerminal({ id: delivery.id, state: "paused_by_plan" });
      return { _tag: "terminal" as const };
    }
    if (delivery.contactId !== null) {
      const topic = subscriptionTopicForIntent(intent.payload);
      const [activeSubscription] = topic === undefined
        ? []
        : yield* db.select({ id: schema.emailSubscriptionTable.id })
          .from(schema.emailSubscriptionTable)
          .innerJoin(schema.emailContactTable, eq(schema.emailContactTable.id, schema.emailSubscriptionTable.contactId))
          .where(and(
            eq(schema.emailSubscriptionTable.contactId, delivery.contactId),
            eq(schema.emailSubscriptionTable.organizationId, intent.organizationId),
            eq(schema.emailSubscriptionTable.topicType, topic.topicType),
            topic.topicId === null ? isNull(schema.emailSubscriptionTable.topicId) : eq(schema.emailSubscriptionTable.topicId, topic.topicId),
            eq(schema.emailSubscriptionTable.state, "active"),
            eq(schema.emailContactTable.verificationState, "verified"),
          ))
          .limit(1);
      if (activeSubscription === undefined) {
        yield* repository.markDeliveryTerminal({ id: delivery.id, state: "suppressed" });
        return { _tag: "terminal" as const };
      }
    }
    const [suppressed] = yield* db.select({ email: schema.emailSuppressionTable.email })
      .from(schema.emailSuppressionTable)
      .where(eq(schema.emailSuppressionTable.email, delivery.recipientEmail))
      .limit(1);
    if (suppressed) {
      yield* repository.markDeliveryTerminal({ id: delivery.id, state: "suppressed" });
      return { _tag: "terminal" as const };
    }
    const claimed = yield* repository.claimDeliveryForSending({ id: delivery.id, now: new Date() });
    if (!claimed) return { _tag: "terminal" as const };
    const payload = yield* Schema.decodeUnknownEffect(NotificationTemplatePayload)(delivery.templatePayload).pipe(
      Effect.mapError(() => new MailTemplateRenderError({}))
    );
    const mailer = yield* Mailer;
    const deferAfterRetryableProviderFailure = (
      error: MailTemporaryDeliveryError | MailUncertainDeliveryError
    ) => {
      const attempt = delivery.attemptCount + 1;
      if (attempt >= maximumDeliveryAttempts) {
        return repository.markDeliveryTerminal({
          id: delivery.id,
          state: "failed",
          lastError: { tag: error._tag, reason: "retry_exhausted" },
        }).pipe(Effect.as<DeliveryAttemptOutcome>({ _tag: "terminal" }));
      }
      const delayMs = retryDelayMs(delivery.id, attempt);
      return repository.markDeliveryDeferred({
        id: delivery.id,
        nextAttemptAt: new Date(Date.now() + delayMs),
        lastError: { tag: error._tag },
      }).pipe(Effect.as<DeliveryAttemptOutcome>({ _tag: "retry", delayMs }));
    };
    const sent = yield* mailer.send({
      ...createNotificationEmail(payload),
      messageId: delivery.messageId,
      to: delivery.recipientEmail,
    }).pipe(
      Effect.map((result) => ({
        _tag: "accepted" as const,
        accepted: result.accepted,
        providerMetadata: result.providerMetadata,
      })),
      Effect.catchTags({
        MailPermanentDeliveryError: (error) => repository.markDeliveryTerminal({
          id: delivery.id,
          state: "failed",
          lastError: { tag: error._tag },
        }).pipe(Effect.as<DeliveryAttemptOutcome>({ _tag: "terminal" })),
        MailTemplateRenderError: (error) => repository.markDeliveryTerminal({
          id: delivery.id,
          state: "failed",
          lastError: { tag: error._tag },
        }).pipe(Effect.as<DeliveryAttemptOutcome>({ _tag: "terminal" })),
        MailTemporaryDeliveryError: deferAfterRetryableProviderFailure,
        MailUncertainDeliveryError: deferAfterRetryableProviderFailure,
      }),
      Effect.flatMap((result) => result._tag === "accepted"
        ? result.accepted
          ? repository.markDeliveryAccepted({
            id: delivery.id,
            acceptedAt: new Date(),
            providerMetadata: result.providerMetadata,
            }).pipe(Effect.as<DeliveryAttemptOutcome>({ _tag: "terminal" }))
          : result.providerMetadata.rejectedRecipientCount > 0
            ? repository.markDeliveryTerminal({
                id: delivery.id,
                state: "failed",
                lastError: {
                  tag: "MailPermanentDeliveryError",
                  reason: "provider_rejected",
                },
              }).pipe(Effect.as<DeliveryAttemptOutcome>({ _tag: "terminal" }))
            : deferAfterRetryableProviderFailure(new MailUncertainDeliveryError({}))
        : Effect.succeed(result)
      )
    );
    return sent;
  });

export const EmailOutboxWorkflowLayer = Layer.mergeAll(
  EmailOutboxDispatcherWorkflow.toLayer(
    Effect.fnUntraced(function* ({ outboxId }) {
      let dispatch: (attempt: number) => Effect.Effect<
        void,
        never,
        | WorkflowEngine.WorkflowEngine
        | WorkflowEngine.WorkflowInstance
        | EmailOutboxRepository
        | EntitlementPolicy
        | DatabaseService
      >;
      dispatch = Effect.fnUntraced(function* (attempt: number) {
        const delay = yield* W.Activity.make({
          name: `LoadEmailOutboxSchedule-${attempt}`,
          success: Schema.Number,
          error: EmailOutboxDataError,
          execute: Effect.gen(function* () {
            const intent = yield* (yield* EmailOutboxRepository).findById(outboxId);
            return intent ? Math.max(0, intent.scheduledAt.getTime() - Date.now()) : 0;
          }).pipe(Effect.mapError(() => new EmailOutboxDataError({ operation: "load schedule", reason: "Could not load email outbox intent" }))),
        }).pipe(Effect.catch(() => Effect.void));
        if (delay === undefined) {
          yield* W.DurableClock.sleep({
            name: `email-outbox-dispatcher-retry-${outboxId}-${attempt}`,
            duration: retryDelayMs(outboxId, attempt),
          });
          return yield* dispatch(attempt + 1);
        }
        if (delay > 0) {
          yield* W.DurableClock.sleep({ name: `email-outbox-scheduled-${outboxId}`, duration: delay });
        }
        const deliveryIds = yield* W.Activity.make({
          name: `MaterializeEmailOutboxIntent-${attempt}`,
          success: Schema.Array(Schema.String),
          error: EmailOutboxDataError,
          execute: materializeSubmission(outboxId).pipe(Effect.mapError(() => new EmailOutboxDataError({ operation: "materialize", reason: "Could not materialize email outbox intent" }))),
        }).pipe(Effect.catch(() => Effect.void));
        if (deliveryIds === undefined) {
          yield* W.DurableClock.sleep({
            name: `email-outbox-dispatcher-retry-${outboxId}-${attempt}`,
            duration: retryDelayMs(outboxId, attempt),
          });
          return yield* dispatch(attempt + 1);
        }
        yield* Effect.forEach(deliveryIds, (deliveryId) =>
          EmailDeliveryWorkflow.execute({ deliveryId }, { discard: true }),
          { discard: true }
        );
      });
      yield* dispatch(1);
    })
  ),
  EmailDeliveryWorkflow.toLayer(
    Effect.fnUntraced(function* ({ deliveryId }) {
      const repository = yield* EmailOutboxRepository;
      let run: (attempt: number) => Effect.Effect<
        void,
        never,
        | WorkflowEngine.WorkflowEngine
        | WorkflowEngine.WorkflowInstance
        | EmailOutboxRepository
        | EntitlementPolicy
        | DatabaseService
        | Mailer
      >;
      run = Effect.fnUntraced(function* (attempt: number) {
        const outcome = yield* W.Activity.make({
          name: `SendEmailDelivery-${attempt}`,
          success: DeliveryAttemptOutcomeSchema,
          error: workflowError,
          execute: sendDeliveryAttempt(deliveryId).pipe(Effect.mapError(() => new EmailOutboxDataError({ operation: "deliver", reason: "Could not process email delivery" }))),
        }).pipe(
          // Database and workflow activity infrastructure failures leave the
          // delivery non-terminal; retry through the durable timer instead of
          // completing this deterministic workflow with a cached failure.
          Effect.catch(() => {
            const delayMs = retryDelayMs(deliveryId, attempt);
            return repository.releaseSendingDelivery({
              id: deliveryId,
              nextAttemptAt: new Date(Date.now() + delayMs),
              lastError: { tag: "EmailDeliveryActivityError" },
            }).pipe(
              Effect.catch(() => Effect.void),
              Effect.as({ _tag: "retry" as const, delayMs })
            );
          })
        );
        if (outcome._tag === "terminal") return;
        yield* W.DurableClock.sleep({
          name: `email-delivery-retry-${deliveryId}-${attempt}`,
          duration: outcome.delayMs,
        });
        yield* run(attempt + 1);
      });
      yield* run(1);
    })
  )
);

/** Best-effort post-commit wake; reconciliation closes any lost-wake window. */
export const wakeEmailOutbox = (outboxId: string) =>
  Effect.gen(function* () {
    const engine = yield* Effect.serviceOption(WorkflowEngine.WorkflowEngine);
    if (Option.isNone(engine)) return;
    yield* EmailOutboxDispatcherWorkflow.execute({ outboxId }, { discard: true }).pipe(
      Effect.provideService(WorkflowEngine.WorkflowEngine, engine.value)
    );
  });

/** Recover database intents and delivery rows whose best-effort workflow wake was lost. */
export const reconcileEmailOutbox = ({ now = new Date(), staleSendingAfterMs = 5 * 60_000 }: {
  readonly now?: Date;
  readonly staleSendingAfterMs?: number;
} = {}): Effect.Effect<void, never, DatabaseService | EmailOutboxRepository | EmailSubscriptionRepository | EntitlementPolicy | WorkflowEngine.WorkflowEngine> =>
  Effect.gen(function* () {
    const repository = yield* EmailOutboxRepository;
    const subscriptions = yield* EmailSubscriptionRepository;
    const policy = yield* EntitlementPolicy;
    const pending = yield* repository.findPending({ before: now });
    const paused = yield* repository.findPausedByPlan({ before: now });
    yield* repository.expirePausedDeliveries({ now });
    const subscriptionOrganizations = yield* subscriptions.findPlanStateOrganizationIds();
    const resumedPausedDeliveryIds = yield* Effect.forEach(
      [...new Set([...subscriptionOrganizations, ...paused.map((intent) => intent.organizationId)])],
      (organizationId) => Effect.gen(function* () {
        const eligible = yield* policy.mayMaterializeEmailIntent({ organizationId, kind: "changelog.published" });
        yield* subscriptions.reconcileSubscriptionPlanStates({ organizationId, eligible });
        return eligible
          ? yield* repository.resumePausedDeliveries({ now, organizationId })
          : [] as readonly string[];
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
      staleSendingBefore: new Date(now.getTime() - staleSendingAfterMs),
    });
    yield* Effect.forEach(intents, (intent) => wakeEmailOutbox(intent.id), { discard: true });
    yield* Effect.forEach(deliveries, (delivery) =>
      EmailDeliveryWorkflow.execute({ deliveryId: delivery.id }, { discard: true }),
      { discard: true }
    );
    yield* Effect.forEach(resumedDeliveryIds.flat(), (deliveryId) =>
      EmailDeliveryWorkflow.execute({ deliveryId }, { discard: true }),
      { discard: true }
    );
    yield* Effect.forEach(resumedPausedDeliveryIds.flat(), (deliveryId) =>
      EmailDeliveryWorkflow.execute({ deliveryId }, { discard: true }),
      { discard: true }
    );
  }).pipe(Effect.catch(() => Effect.void));
