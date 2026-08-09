import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import {
  MailerTestLayer,
  resetTestMailer,
  testMailerState,
} from "@feeblo/transactional/mailer/test";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";
import * as WorkflowEngine from "effect/unstable/workflow/WorkflowEngine";
import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import { WorkspaceRepository } from "../workspace/repository";
import { EmailOutboxConfig } from "./config";
import { EmailOutboxRepository } from "./repository";
import {
  EmailDeliveryWorkflow,
  EmailOutboxDispatcherWorkflow,
  EmailOutboxWorkflowLayer,
  reconcileEmailOutbox,
} from "./workflow";

const TestLayer = EmailOutboxWorkflowLayer.pipe(
  Layer.provideMerge(
    EmailOutboxConfig.layerTest(new URL("https://test.feeblo.example"))
  ),
  Layer.provideMerge(MailerTestLayer),
  Layer.provideMerge(EmailOutboxRepository.layer),
  Layer.provideMerge(EmailSubscriptionRepository.layer),
  Layer.provideMerge(
    EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer))
  ),
  Layer.provideMerge(WorkflowEngine.layerMemory),
  Layer.provideMerge(Database.PgliteDatabaseLive)
);

const fixture = Effect.gen(function* () {
  const db = yield* currentDb;
  const organizationId = yield* WorkspaceId.generate;
  const userId = `usr_${organizationId}`;
  const ownerId = `mem_${organizationId}`;
  const boardId = `brd_${organizationId}`;
  const statusId = `pst_${organizationId}`;
  const postId = `post_${organizationId}`;
  const now = new Date();
  yield* db.insert(schema.organizationTable).values({
    id: organizationId,
    name: "Outbox",
    slug: organizationId,
    createdAt: now,
  });
  const ownerEmail = `owner-${organizationId}@example.test`;
  yield* db
    .insert(schema.userTable)
    .values({ id: userId, email: ownerEmail, name: "Owner" });
  yield* db.insert(schema.memberTable).values({
    id: ownerId,
    organizationId,
    userId,
    role: "owner",
    createdAt: now,
  });
  yield* db.insert(schema.boardTable).values({
    id: boardId,
    organizationId,
    name: "Feedback",
    slug: "feedback",
    visibility: "PUBLIC",
    creatorId: userId,
    creatorMemberId: ownerId,
    createdAt: now,
    updatedAt: now,
  });
  yield* db
    .insert(schema.postStatusTable)
    .values({ id: statusId, organizationId, type: "PENDING", orderIndex: 0 });
  yield* db.insert(schema.postTable).values({
    id: postId,
    organizationId,
    boardId,
    statusId,
    title: "Ship email outbox",
    slug: "ship-email-outbox",
    content: "x",
    excerpt: "x",
    creatorId: userId,
    creatorMemberId: ownerId,
    createdAt: now,
    updatedAt: now,
  });
  const intent = yield* (yield* EmailOutboxRepository).recordIntent({
    aggregateId: postId,
    aggregateType: "post",
    deduplicationKey: `submission.created:${organizationId}:${postId}`,
    expiresAt: null,
    kind: "submission.created",
    organizationId,
    payload: { kind: "submission.created", postId },
    scheduledAt: now,
  });
  if (intent._tag !== "Inserted") {
    return yield* Effect.die("Expected inserted outbox intent");
  }
  return { intentId: intent.intent.id, organizationId, ownerEmail };
});

const enableSubscriberEmails = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const now = new Date();
    const productId = `product_${organizationId}`;
    yield* db.insert(schema.productTable).values({
      id: productId,
      name: "Starter",
      isRecurring: true,
      isArchived: false,
      externalOrganizationId: "feeblo",
      visibility: "public",
      metadata: { plan: "starter", variant: "monthly" },
      createdAt: now,
      updatedAt: now,
    });
    yield* db.insert(schema.subscriptionTable).values({
      id: `subscription_${organizationId}`,
      externalId: `external_${organizationId}`,
      organizationId,
      amount: 1000,
      cancelAtPeriodEnd: false,
      currency: "usd",
      recurringInterval: "month",
      recurringIntervalCount: 1,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 86_400_000),
      customerId: `customer_${organizationId}`,
      productId,
      createdAt: now,
      updatedAt: now,
    });
  });

const addSubscriptionContact = (args: {
  readonly email: string;
  readonly organizationId: string;
  readonly state: "active" | "pending_verification" | "unsubscribed";
  readonly topicId: string | null;
  readonly topicType: "changelog" | "post";
}) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const now = new Date();
    const contactId = `contact_${args.email.replaceAll(/[^a-z0-9]/g, "_")}`;
    const subscriptionId = `subscription_${args.email.replaceAll(/[^a-z0-9]/g, "_")}_${args.topicType}`;
    yield* db
      .insert(schema.emailContactTable)
      .values({
        id: contactId,
        organizationId: args.organizationId,
        userId: null,
        email: args.email,
        verificationState:
          args.state === "pending_verification" ? "pending" : "verified",
        verifiedAt: args.state === "pending_verification" ? null : now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [
          schema.emailContactTable.organizationId,
          schema.emailContactTable.email,
        ],
      });
    yield* db.insert(schema.emailSubscriptionTable).values({
      id: subscriptionId,
      organizationId: args.organizationId,
      contactId,
      topicType: args.topicType,
      topicId: args.topicId,
      source: "explicit",
      state: args.state,
      verificationTokenHash: null,
      verificationExpiresAt: null,
      unsubscribeTokenHash: "previous-token-hash",
      verifiedAt: args.state === "active" ? now : null,
      unsubscribedAt: args.state === "unsubscribed" ? now : null,
      createdAt: now,
      updatedAt: now,
    });
    return { contactId, subscriptionId };
  });

const waitForDelivery = (
  outboxId: string,
  predicate: (
    delivery: typeof schema.emailDeliveryTable.$inferSelect
  ) => boolean
) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;
    for (let poll = 0; poll < 100; poll += 1) {
      const [delivery] = yield* db
        .select()
        .from(schema.emailDeliveryTable)
        .where(eq(schema.emailDeliveryTable.outboxId, outboxId));
      if (delivery !== undefined && predicate(delivery)) {
        return delivery;
      }
      yield* Effect.yieldNow;
    }
    return yield* Effect.die("Email delivery did not reach the expected state");
  });

const waitForIntentState = (outboxId: string, state: string) =>
  Effect.gen(function* () {
    const repository = yield* EmailOutboxRepository;
    for (let poll = 0; poll < 100; poll += 1) {
      if ((yield* repository.findById(outboxId))?.state === state) {
        return;
      }
      yield* Effect.yieldNow;
    }
    return yield* Effect.die("Email intent did not reach the expected state");
  });

describe("EmailOutbox workflows", () => {
  layer(TestLayer)("memory workflow engine", (it) => {
    it.effect(
      "reconciliation recovers a missed submission wake and sends only the free owner",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { intentId, ownerEmail } = yield* fixture;
          yield* reconcileEmailOutbox();
          yield* waitForDelivery(
            intentId,
            (delivery) => delivery.state === "accepted"
          );
          const state = yield* testMailerState;
          expect(state.sentMessages).toHaveLength(1);
          expect(state.sentMessages[0]).toMatchObject({
            to: ownerEmail.toLowerCase(),
          });
          const db = yield* Database.Database;
          const deliveries = yield* db
            .select()
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.outboxId, intentId));
          expect(deliveries).toHaveLength(1);
          expect(deliveries[0]?.state).toBe("accepted");
        })
    );

    it.effect(
      "repeat reconciliation does not duplicate a materialized delivery",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { organizationId } = yield* fixture;
          yield* reconcileEmailOutbox();
          const db = yield* Database.Database;
          const [intent] = yield* db
            .select({ id: schema.emailOutboxTable.id })
            .from(schema.emailOutboxTable)
            .where(eq(schema.emailOutboxTable.organizationId, organizationId));
          if (intent === undefined) {
            return yield* Effect.die("Expected an email outbox intent");
          }
          yield* waitForDelivery(
            intent.id,
            (delivery) => delivery.state === "accepted"
          );
          yield* reconcileEmailOutbox();
          const deliveries = yield* db.query.emailDeliveryTable.findMany({
            with: { outbox: { columns: { organizationId: true } } },
          });
          expect(
            deliveries.filter(
              (delivery) => delivery.outbox?.organizationId === organizationId
            )
          ).toHaveLength(1);
        })
    );

    it.effect(
      "retries one temporary delivery with its stored deterministic message id",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer({
            outcomes: [{ _tag: "temporaryFailure" }, { _tag: "accepted" }],
          });
          const { intentId } = yield* fixture;
          yield* EmailOutboxDispatcherWorkflow.execute(
            { outboxId: intentId },
            { discard: true }
          );
          yield* waitForDelivery(
            intentId,
            (delivery) =>
              delivery.state === "deferred" && delivery.attemptCount === 1
          );
          yield* TestClock.adjust("2 seconds");
          yield* waitForDelivery(
            intentId,
            (delivery) => delivery.state === "accepted"
          );
          const state = yield* testMailerState;
          expect(state.attempts).toBeGreaterThanOrEqual(2);
          expect(state.sentMessages.length).toBeGreaterThanOrEqual(1);
          const db = yield* Database.Database;
          const [delivery] = yield* db
            .select()
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.outboxId, intentId));
          expect(
            state.sentMessages.some(
              (message) => message.messageId === delivery?.messageId
            )
          ).toBe(true);
          expect(delivery?.state).toBe("accepted");
        })
    );

    it.effect(
      "materializes verified changelog subscribers without persisting bearer tokens",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { organizationId } = yield* fixture;
          const db = yield* Database.Database;
          yield* enableSubscriberEmails(organizationId);
          const changelogId = `changelog_${organizationId}`;
          const subscriber = yield* addSubscriptionContact({
            email: `changelog-${organizationId}@example.test`,
            organizationId,
            state: "active",
            topicId: null,
            topicType: "changelog",
          });
          yield* db.insert(schema.changelogTable).values({
            id: changelogId,
            organizationId,
            title: "New release",
            slug: "new-release",
            content: "Release notes",
            excerpt: "Release notes",
            status: "published",
            publishedAt: new Date(),
            creatorId: null,
            creatorMemberId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          const intent = yield* (yield* EmailOutboxRepository).recordIntent({
            aggregateId: changelogId,
            aggregateType: "changelog",
            deduplicationKey: `changelog.published:${organizationId}:${changelogId}`,
            expiresAt: null,
            kind: "changelog.published",
            organizationId,
            payload: { kind: "changelog.published", changelogId },
            scheduledAt: new Date(),
          });
          if (intent._tag !== "Inserted") {
            return yield* Effect.die("Expected changelog intent");
          }
          yield* EmailOutboxDispatcherWorkflow.execute({
            outboxId: intent.intent.id,
          });
          yield* waitForDelivery(
            intent.intent.id,
            (delivery) => delivery.state === "accepted"
          );
          const state = yield* testMailerState;
          expect(state.sentMessages).toHaveLength(1);
          expect(state.sentMessages[0]).toMatchObject({
            to: `changelog-${organizationId}@example.test`.toLowerCase(),
          });
          expect(
            state.sentMessages[0]?.headers?.["List-Unsubscribe"]
          ).toBeUndefined();
          expect(
            state.sentMessages[0]?.headers?.["List-Unsubscribe-Post"]
          ).toBeUndefined();
          const [storedSubscription] = yield* db
            .select({
              unsubscribeTokenHash:
                schema.emailSubscriptionTable.unsubscribeTokenHash,
            })
            .from(schema.emailSubscriptionTable)
            .where(
              eq(schema.emailSubscriptionTable.id, subscriber.subscriptionId)
            );
          expect(storedSubscription?.unsubscribeTokenHash).toBe(
            "previous-token-hash"
          );
          const [delivery] = yield* db
            .select()
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.outboxId, intent.intent.id));
          expect(delivery?.contactId).toBe(subscriber.contactId);
          expect(delivery?.templatePayload).toMatchObject({
            title: "New changelog: New release",
            unsubscribeUrl:
              "https://test.feeblo.example/settings/notifications",
          });
        })
    );

    it.effect(
      "materializes only active unsuppressed post subscribers using the final post status",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { organizationId } = yield* fixture;
          const db = yield* Database.Database;
          yield* enableSubscriberEmails(organizationId);
          const [post] = yield* db
            .select()
            .from(schema.postTable)
            .where(eq(schema.postTable.id, `post_${organizationId}`));
          if (!post) {
            return yield* Effect.die("Expected fixture post");
          }
          const finalStatusId = `status_final_${organizationId}`;
          yield* db.insert(schema.postStatusTable).values({
            id: finalStatusId,
            organizationId,
            type: "IN_PROGRESS",
            orderIndex: 1,
          });
          yield* db
            .update(schema.postTable)
            .set({ statusId: finalStatusId })
            .where(eq(schema.postTable.id, post.id));
          const verified = yield* addSubscriptionContact({
            email: `verified-${organizationId}@example.test`,
            organizationId,
            state: "active",
            topicId: post.id,
            topicType: "post",
          });
          yield* addSubscriptionContact({
            email: `pending-${organizationId}@example.test`,
            organizationId,
            state: "pending_verification",
            topicId: post.id,
            topicType: "post",
          });
          yield* addSubscriptionContact({
            email: `unsubscribed-${organizationId}@example.test`,
            organizationId,
            state: "unsubscribed",
            topicId: post.id,
            topicType: "post",
          });
          const suppressed = yield* addSubscriptionContact({
            email: `suppressed-${organizationId}@example.test`,
            organizationId,
            state: "active",
            topicId: post.id,
            topicType: "post",
          });
          yield* db.insert(schema.emailSuppressionTable).values({
            email: `suppressed-${organizationId}@example.test`,
            reason: "hard_bounce",
            providerEventId: null,
          });
          const intent =
            yield* (yield* EmailOutboxRepository).upsertPendingStatusChange({
              aggregateId: post.id,
              aggregateType: "post",
              deduplicationKey: `post.status_changed:${organizationId}:${post.id}:test`,
              expiresAt: null,
              organizationId,
              payload: {
                kind: "post.status_changed",
                postId: post.id,
                statusId: `pst_${organizationId}`,
              },
              scheduledAt: new Date(),
            });
          if (intent._tag !== "Written") {
            return yield* Effect.die("Expected post intent");
          }
          yield* EmailOutboxDispatcherWorkflow.execute({
            outboxId: intent.intent.id,
          });
          yield* waitForDelivery(
            intent.intent.id,
            (delivery) => delivery.state === "accepted"
          );
          const state = yield* testMailerState;
          expect(state.sentMessages).toHaveLength(1);
          expect(state.sentMessages[0]?.to).toBe(
            `verified-${organizationId}@example.test`.toLowerCase()
          );
          const [delivery] = yield* db
            .select()
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.outboxId, intent.intent.id));
          expect(delivery?.contactId).toBe(verified.contactId);
          expect(delivery?.templatePayload).toMatchObject({
            title: expect.stringContaining("In Progress"),
          });
          expect(
            (yield* (yield* EmailOutboxRepository).findById(intent.intent.id))
              ?.state
          ).toBe("materialized");
          const [suppressedDelivery] = yield* db
            .select({ id: schema.emailDeliveryTable.id })
            .from(schema.emailDeliveryTable)
            .where(
              and(
                eq(schema.emailDeliveryTable.outboxId, intent.intent.id),
                eq(
                  schema.emailDeliveryTable.contactId,
                  suppressed.contactId
                )
              )
            );
          expect(suppressedDelivery).toBeUndefined();
        })
    );

    it.effect(
      "rechecks unsubscribe consent after materialization and before provider send",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { organizationId } = yield* fixture;
          const db = yield* Database.Database;
          yield* enableSubscriberEmails(organizationId);
          const postId = `post_${organizationId}`;
          const subscriber = yield* addSubscriptionContact({
            email: `consent-${organizationId}@example.test`,
            organizationId,
            state: "active",
            topicId: postId,
            topicType: "post",
          });
          const intent = yield* (yield* EmailOutboxRepository).recordIntent({
            aggregateId: postId,
            aggregateType: "post",
            deduplicationKey: `post.closed:${organizationId}:${postId}:consent-race`,
            expiresAt: new Date(Date.now() + 86_400_000),
            kind: "post.closed",
            organizationId,
            payload: { kind: "post.closed", postId },
            scheduledAt: new Date(),
          });
          if (intent._tag !== "Inserted") {
            return yield* Effect.die("Expected consent-race intent");
          }
          yield* db
            .update(schema.emailOutboxTable)
            .set({ state: "materialized" })
            .where(eq(schema.emailOutboxTable.id, intent.intent.id));
          const delivery = yield* (yield* EmailOutboxRepository).createDelivery(
            {
              contactId: subscriber.contactId,
              outboxId: intent.intent.id,
              recipientEmail: `consent-${organizationId}@example.test`,
              template: "subscription-notification",
              templateVersion: 1,
              templatePayload: {
                actionLabel: "View post",
                actionUrl: "https://app.feeblo.com/post",
                body: "A post was closed.",
                eyebrow: "Feedback",
                posts: [],
                title: "Post closed",
                unsubscribeUrl: "https://app.feeblo.com/settings/notifications",
              },
            }
          );
          if (delivery._tag !== "Inserted") {
            return yield* Effect.die("Expected consent-race delivery");
          }
          yield* db
            .update(schema.emailSubscriptionTable)
            .set({ state: "unsubscribed" })
            .where(
              eq(schema.emailSubscriptionTable.id, subscriber.subscriptionId)
            );

          yield* EmailDeliveryWorkflow.execute({
            deliveryId: delivery.delivery.id,
          });

          expect((yield* testMailerState).attempts).toBe(0);
          expect(
            (yield* (yield* EmailOutboxRepository).findDeliveryById(
              delivery.delivery.id
            ))?.state
          ).toBe("suppressed");
        })
    );

    it.effect(
      "pauses a subscriber intent on downgrade and reconciles it after upgrade while unexpired",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { organizationId } = yield* fixture;
          const db = yield* Database.Database;
          const changelogId = `resume_changelog_${organizationId}`;
          yield* db.insert(schema.changelogTable).values({
            id: changelogId,
            organizationId,
            title: "Upgrade release",
            slug: "upgrade-release",
            content: "x",
            excerpt: "x",
            status: "published",
            publishedAt: new Date(),
            creatorId: null,
            creatorMemberId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          const intent = yield* (yield* EmailOutboxRepository).recordIntent({
            aggregateId: changelogId,
            aggregateType: "changelog",
            deduplicationKey: `changelog.resume:${organizationId}:${changelogId}`,
            expiresAt: new Date(Date.now() + 86_400_000),
            kind: "changelog.published",
            organizationId,
            payload: { kind: "changelog.published", changelogId },
            scheduledAt: new Date(),
          });
          if (intent._tag !== "Inserted") {
            return yield* Effect.die("Expected resumable intent");
          }
          yield* EmailOutboxDispatcherWorkflow.execute({
            outboxId: intent.intent.id,
          });
          expect(
            (yield* (yield* EmailOutboxRepository).findById(intent.intent.id))
              ?.state
          ).toBe("paused_by_plan");

          yield* enableSubscriberEmails(organizationId);
          yield* reconcileEmailOutbox();
          yield* waitForIntentState(intent.intent.id, "materialized");

          expect(
            (yield* (yield* EmailOutboxRepository).findById(intent.intent.id))
              ?.state
          ).toBe("materialized");
        })
    );

    it.effect(
      "marks a permanent provider failure terminal without retrying",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer({
            outcomes: Array.from({ length: 20 }, () => ({
              _tag: "permanentFailure" as const,
              smtpStatusCode: 550,
            })),
          });
          const { intentId } = yield* fixture;
          yield* EmailOutboxDispatcherWorkflow.execute({ outboxId: intentId });
          yield* waitForDelivery(
            intentId,
            (delivery) => delivery.state === "failed"
          );
          const db = yield* Database.Database;
          const [delivery] = yield* db
            .select()
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.outboxId, intentId));
          expect(delivery?.attemptCount).toBe(1);
          expect(delivery?.state).toBe("failed");
        })
    );

    it.effect(
      "does not mark an explicitly rejected provider result as accepted",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer({
            outcomes: [{ _tag: "accepted", accepted: false }],
          });
          const { intentId } = yield* fixture;
          yield* EmailOutboxDispatcherWorkflow.execute({ outboxId: intentId });
          yield* waitForDelivery(
            intentId,
            (delivery) => delivery.state === "failed"
          );
          const db = yield* Database.Database;
          const [delivery] = yield* db
            .select()
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.outboxId, intentId));
          expect((yield* testMailerState).attempts).toBe(1);
          expect(delivery?.state).toBe("failed");
          expect(delivery?.lastError).toMatchObject({
            tag: "MailPermanentDeliveryError",
            reason: "provider_rejected",
          });
        })
    );

    it.effect(
      "bounds temporary failures and records retry exhaustion as terminal",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer({
            outcomes: [
              { _tag: "temporaryFailure" },
              { _tag: "temporaryFailure" },
              { _tag: "temporaryFailure" },
              { _tag: "temporaryFailure" },
              { _tag: "temporaryFailure" },
            ],
          });
          const { intentId } = yield* fixture;
          yield* EmailOutboxDispatcherWorkflow.execute(
            { outboxId: intentId },
            { discard: true }
          );
          for (const _attempt of [1, 2, 3, 4]) {
            const delivery = yield* waitForDelivery(
              intentId,
              (candidate) => candidate.attemptCount >= _attempt
            );
            if (delivery.state === "failed") {
              break;
            }
            yield* TestClock.adjust("2 hours");
          }
          yield* waitForDelivery(
            intentId,
            (delivery) => delivery.state === "failed"
          );
          const db = yield* Database.Database;
          const [delivery] = yield* db
            .select()
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.outboxId, intentId));
          expect(delivery?.state).toBe("failed");
          expect(delivery?.attemptCount).toBe(5);
        })
    );

    it.effect(
      "reconciliation starts an orphaned queued delivery after materialization",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { intentId } = yield* fixture;
          const repository = yield* EmailOutboxRepository;
          const db = yield* Database.Database;
          yield* db
            .update(schema.emailOutboxTable)
            .set({ state: "materialized" })
            .where(eq(schema.emailOutboxTable.id, intentId));
          const delivery = yield* repository.createDelivery({
            outboxId: intentId,
            recipientEmail: `orphan-${intentId}@example.test`,
            template: "submission-notification",
            templateVersion: 1,
            templatePayload: {
              actionLabel: "View dashboard",
              actionUrl: "https://app.feeblo.com",
              body: "A new post has been submitted.",
              eyebrow: "Feedback",
              posts: [],
              title: "New submission in your workspace",
              unsubscribeUrl: "https://app.feeblo.com/settings/notifications",
            },
          });
          if (delivery._tag !== "Inserted") {
            return yield* Effect.die("Expected queued orphan delivery");
          }
          yield* reconcileEmailOutbox();
          yield* EmailDeliveryWorkflow.execute({
            deliveryId: delivery.delivery.id,
          });
          expect(
            (yield* repository.findDeliveryById(delivery.delivery.id))?.state
          ).toBe("accepted");
        })
    );

    it.effect(
      "keeps a stranded sending delivery durable until reconciliation releases its lease",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { intentId } = yield* fixture;
          const repository = yield* EmailOutboxRepository;
          const db = yield* Database.Database;
          yield* db
            .update(schema.emailOutboxTable)
            .set({ state: "materialized" })
            .where(eq(schema.emailOutboxTable.id, intentId));
          const delivery = yield* repository.createDelivery({
            outboxId: intentId,
            recipientEmail: `stranded-${intentId}@example.test`,
            template: "submission-notification",
            templateVersion: 1,
            templatePayload: {
              actionLabel: "View dashboard",
              actionUrl: "https://app.feeblo.com",
              body: "A new post has been submitted.",
              eyebrow: "Feedback",
              posts: [],
              title: "New submission in your workspace",
              unsubscribeUrl: "https://app.feeblo.com/settings/notifications",
            },
          });
          if (delivery._tag !== "Inserted") {
            return yield* Effect.die("Expected stranded delivery");
          }
          yield* db
            .update(schema.emailDeliveryTable)
            .set({
              state: "sending",
              updatedAt: new Date(Date.now() - 10 * 60 * 1000),
            })
            .where(eq(schema.emailDeliveryTable.id, delivery.delivery.id));

          yield* EmailDeliveryWorkflow.execute(
            { deliveryId: delivery.delivery.id },
            { discard: true }
          );
          yield* reconcileEmailOutbox();
          yield* waitForDelivery(
            intentId,
            (stored) =>
              stored.state === "deferred" || stored.state === "accepted"
          );
          yield* TestClock.adjust("6 minutes");
          yield* waitForDelivery(
            intentId,
            (stored) => stored.state === "accepted"
          );

          expect(
            (yield* repository.findDeliveryById(delivery.delivery.id))?.state
          ).toBe("accepted");
          expect((yield* testMailerState).attempts).toBeGreaterThanOrEqual(1);
        })
    );

    it.effect(
      "does not send again when a terminal delivery workflow is replayed",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer({ outcomes: [{ _tag: "permanentFailure" }] });
          const { intentId } = yield* fixture;
          yield* EmailOutboxDispatcherWorkflow.execute({ outboxId: intentId });
          yield* waitForDelivery(
            intentId,
            (delivery) => delivery.state === "failed"
          );
          const db = yield* Database.Database;
          const [delivery] = yield* db
            .select()
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.outboxId, intentId));
          if (!delivery) {
            return yield* Effect.die("Expected delivery");
          }
          const attemptsBeforeReplay = (yield* testMailerState).attempts;
          yield* EmailDeliveryWorkflow.execute({ deliveryId: delivery.id });
          expect((yield* testMailerState).attempts).toBe(attemptsBeforeReplay);
        })
    );
  });
});
