import { createHmac } from "node:crypto";
import { assert, describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { EmailDeliveryId, EmailEventId } from "@feeblo/id";
import {
  MailerTestLayer,
  resetTestMailer,
  testMailerState,
} from "@feeblo/transactional/mailer/test";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { TestClock } from "effect/testing";
import * as RateLimiter from "effect/unstable/persistence/RateLimiter";
import * as Workflow from "effect/unstable/workflow/Workflow";
import * as WorkflowEngine from "effect/unstable/workflow/WorkflowEngine";
import { EmailConfig } from "./config";
import { EmailHealthService } from "./health";
import { EmailEventRepository } from "./repository";
import { verifySignature } from "./webhook";
import {
  PostStatusChangedEmailWorkflow,
  PostStatusChangedEmailWorkflowLayer,
} from "./workflow";

const makeTestConfig = (overrides: {
  readonly dailyCapPerRecipient?: number;
  readonly digestWindow?: Duration.Duration;
  readonly maxAttempts?: number;
  readonly providerSendsPerSecond?: number;
  readonly unsubscribeSecrets?: string[];
}) =>
  EmailConfig.of({
    consecutiveFailuresAlertThreshold: 5,
    dailyCapPerRecipient: overrides.dailyCapPerRecipient ?? 10,
    digestWindow: overrides.digestWindow ?? Duration.minutes(15),
    maxAttempts: overrides.maxAttempts ?? 8,
    providerSendsPerSecond: overrides.providerSendsPerSecond ?? 100,
    smtpConfigured: true,
    unsubscribeSecrets: overrides.unsubscribeSecrets ?? [
      "test-unsubscribe-secret",
    ],
    webhookSecret: null,
  });

const TestConfig = Layer.succeed(EmailConfig, makeTestConfig({}));

const TestLayer = PostStatusChangedEmailWorkflowLayer.pipe(
  Layer.provideMerge(MailerTestLayer),
  Layer.provideMerge(WorkflowEngine.layerMemory),
  Layer.provideMerge(EmailEventRepository.layer),
  Layer.provideMerge(EmailHealthService.layer),
  Layer.provideMerge(Database.PgliteDatabaseLive),
  Layer.provideMerge(
    RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory))
  ),
  Layer.provideMerge(TestConfig)
);

/** Layer with a 1-send/second provider budget (for throttle assertions). */
const ThrottledTestLayer = PostStatusChangedEmailWorkflowLayer.pipe(
  Layer.provideMerge(MailerTestLayer),
  Layer.provideMerge(WorkflowEngine.layerMemory),
  Layer.provideMerge(EmailEventRepository.layer),
  Layer.provideMerge(EmailHealthService.layer),
  Layer.provideMerge(Database.PgliteDatabaseLive),
  Layer.provideMerge(
    RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory))
  ),
  Layer.provideMerge(
    Layer.succeed(EmailConfig, makeTestConfig({ providerSendsPerSecond: 1 }))
  )
);

type Fixture = {
  actorMemberId: string;
  actorUserId: string;
  organizationId: string;
  postId: string;
  recipientEmails: readonly string[];
  statusId: string;
  subscriberMemberId: string;
  subscriberUserId: string;
};

const makeFixture = (emails: readonly string[]) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const suffix = crypto.randomUUID();
    const organizationId = `organization_${suffix}`;
    const actorUserId = `actor_${suffix}`;
    const actorMemberId = `member_actor_${suffix}`;
    const boardId = `board_${suffix}`;
    const statusId = `status_${suffix}`;
    const now = new Date();

    yield* db.insert(schema.organizationTable).values({
      id: organizationId,
      name: "Acme",
      slug: `acme-${suffix}`,
      createdAt: now,
    });

    const users = [
      { id: actorUserId, email: emails[0] ?? `actor-${suffix}@acme.test` },
      ...emails.slice(1).map((email, index) => ({
        id: `user_${index}_${suffix}`,
        email,
      })),
    ];
    yield* db
      .insert(schema.userTable)
      .values(users.map((user) => ({ ...user, name: "Member" })));
    yield* db.insert(schema.memberTable).values([
      {
        id: actorMemberId,
        organizationId,
        userId: actorUserId,
        role: "owner",
        createdAt: now,
      },
      ...emails.slice(1).map((_, index) => ({
        id: `member_${index}_${suffix}`,
        organizationId,
        userId: `user_${index}_${suffix}`,
        role: "manager" as const,
        createdAt: now,
      })),
    ]);
    yield* db.insert(schema.boardTable).values({
      id: boardId,
      name: "Feedback",
      slug: "feedback",
      visibility: "PUBLIC",
      organizationId,
      creatorId: actorUserId,
      creatorMemberId: actorMemberId,
      createdAt: now,
      updatedAt: now,
    });
    yield* db.insert(schema.postStatusTable).values([
      { id: statusId, type: "PENDING", orderIndex: 0, organizationId },
      {
        id: `status_in_progress_${suffix}`,
        type: "IN_PROGRESS",
        orderIndex: 1,
        organizationId,
      },
    ]);

    const postId = `post_${suffix}`;
    yield* db.insert(schema.postTable).values({
      id: postId,
      title: "Keyboard shortcuts",
      slug: "keyboard-shortcuts",
      content: "Please",
      excerpt: "Please",
      boardId,
      statusId,
      organizationId,
      creatorId: actorUserId,
      creatorMemberId: actorMemberId,
      createdAt: now,
      updatedAt: now,
    });

    for (const [index] of emails.slice(1).entries()) {
      yield* db.insert(schema.postSubscriptionTable).values({
        id: `sub_${index}_${suffix}`,
        postId,
        userId: `user_${index}_${suffix}`,
        memberId: `member_${index}_${suffix}`,
        organizationId,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      actorMemberId,
      actorUserId,
      organizationId,
      postId,
      recipientEmails: emails,
      statusId,
      subscriberMemberId: `member_0_${suffix}`,
      subscriberUserId: `user_0_${suffix}`,
    } satisfies Fixture;
  });

const enqueueChange = (
  fixture: Fixture,
  previousStatusId: string,
  nextStatusId: string
) =>
  Effect.gen(function* () {
    const repository = yield* EmailEventRepository;
    const result = yield* repository.enqueuePostStatusChanged({
      organizationId: fixture.organizationId,
      postId: fixture.postId,
      actorMemberId: fixture.actorMemberId,
      actorUserId: fixture.actorUserId,
      previousStatusId,
      nextStatusId,
    });
    assert(result);
    return result;
  });

const waitForSentCount = (count: number) =>
  Effect.gen(function* () {
    let attempts = 0;
    while ((yield* testMailerState).sentMessages.length < count) {
      attempts += 1;
      if (attempts > 200) {
        throw new Error(`Timed out waiting for ${count} sent emails`);
      }
      yield* Effect.yieldNow;
    }
  });

describe("Email delivery pipeline (phases 4-5)", () => {
  layer(ThrottledTestLayer)("provider rate limiting", (it) => {
    it.effect(
      "backs off the batch when the per-second send budget is exhausted",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const fixture = yield* makeFixture([
            `actor-${crypto.randomUUID()}@acme.test`,
            `one-${crypto.randomUUID()}@acme.test`,
            `two-${crypto.randomUUID()}@acme.test`,
          ]);
          const suffix = fixture.organizationId.split("_").at(-1);
          assert(suffix);
          const inProgressId = `status_in_progress_${suffix}`;

          // Budget of 1 send/second: the second recipient must wait.
          const repository = yield* EmailEventRepository;
          const { eventId } = yield* enqueueChange(
            fixture,
            fixture.statusId,
            inProgressId
          );
          yield* repository.scheduleEvent(eventId, fixture.organizationId);
          const executionId = yield* PostStatusChangedEmailWorkflow.executionId(
            {
              eventId,
              organizationId: fixture.organizationId,
            }
          );

          yield* Effect.yieldNow;
          yield* TestClock.adjust("15 minutes");
          yield* waitForSentCount(1);
          expect((yield* testMailerState).sentMessages).toHaveLength(1);

          yield* TestClock.adjust("2 seconds");
          const exit = yield* Effect.exit(
            PostStatusChangedEmailWorkflow.execute({
              eventId,
              organizationId: fixture.organizationId,
            })
          );
          expect(exit).toEqual(Exit.void);
          expect((yield* testMailerState).sentMessages).toHaveLength(2);
          expect(
            yield* PostStatusChangedEmailWorkflow.poll(executionId)
          ).toEqual(Option.some(new Workflow.Complete({ exit: Exit.void })));
        })
    );
  });

  layer(TestLayer)("workspace daily quota", (it) => {
    it.effect(
      "drops the enqueue when the workspace is over its plan quota",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const fixture = yield* makeFixture([
            `actor-${crypto.randomUUID()}@acme.test`,
            `sub-${crypto.randomUUID()}@acme.test`,
          ]);
          const suffix = fixture.organizationId.split("_").at(-1);
          assert(suffix);
          const inProgressId = `status_in_progress_${suffix}`;
          const db = yield* Database.Database;
          const quotaRecipient = fixture.recipientEmails[1];
          assert(quotaRecipient);

          // No subscription → free plan → 100 notification emails/day.
          for (let i = 0; i < 100; i += 1) {
            const eventId = `quota_event_${suffix}_${i}`;
            yield* db.insert(schema.emailEventTable).values({
              id: eventId,
              kind: "post_status_changed",
              organizationId: fixture.organizationId,
              payload: {
                kind: "post_status_changed",
                organizationId: fixture.organizationId,
                postId: fixture.postId,
                postTitle: "Prior",
                postUrl: "https://app.feeblo.com",
                actorMemberId: null,
                actorUserId: null,
                changes: [],
              },
              dedupeKey: `quota_${suffix}_${i}`,
              status: "sent",
            });
            yield* db.insert(schema.emailDeliveryTable).values({
              id: `quota_delivery_${suffix}_${i}`,
              eventId,
              organizationId: fixture.organizationId,
              recipient: quotaRecipient,
              template: "post-status-changed",
              status: "sent",
              sentAt: new Date(),
            });
          }

          const repository = yield* EmailEventRepository;
          const result = yield* repository.enqueuePostStatusChanged({
            organizationId: fixture.organizationId,
            postId: fixture.postId,
            actorMemberId: fixture.actorMemberId,
            actorUserId: fixture.actorUserId,
            previousStatusId: fixture.statusId,
            nextStatusId: inProgressId,
          });
          expect(result).toBeNull();
        })
    );
  });

  layer(TestLayer)("webhook ingestion", (it) => {
    it.effect(
      "suppresses bounced addresses and stamps the delivery record",
      () =>
        Effect.gen(function* () {
          const fixture = yield* makeFixture([
            `actor-${crypto.randomUUID()}@acme.test`,
            `bounce-${crypto.randomUUID()}@acme.test`,
          ]);
          const suffix = fixture.organizationId.split("_").at(-1);
          assert(suffix);
          const db = yield* Database.Database;
          const bouncedEmail = fixture.recipientEmails[1];
          assert(bouncedEmail);
          const eventId = yield* EmailEventId.generate;
          const deliveryId = yield* EmailDeliveryId.generate;
          const messageId = `<email-event.${eventId}.x@notifications.feeblo>`;

          yield* db.insert(schema.emailEventTable).values({
            id: eventId,
            kind: "post_status_changed",
            organizationId: fixture.organizationId,
            payload: {
              kind: "post_status_changed",
              organizationId: fixture.organizationId,
              postId: fixture.postId,
              postTitle: "Prior",
              postUrl: "https://app.feeblo.com",
              actorMemberId: null,
              actorUserId: null,
              changes: [],
            },
            dedupeKey: `bounce_event_${suffix}`,
            status: "sent",
          });
          yield* db.insert(schema.emailDeliveryTable).values({
            id: deliveryId,
            eventId,
            organizationId: fixture.organizationId,
            recipient: bouncedEmail.toLowerCase(),
            template: "post-status-changed",
            status: "sent",
            providerMessageId: messageId,
            sentAt: new Date(),
          });

          const repository = yield* EmailEventRepository;
          yield* repository.recordBounceOrComplaint({
            email: bouncedEmail.toUpperCase(),
            messageId,
            type: "hard_bounce",
          });

          const suppressed = yield* db.query.suppressedEmailTable.findFirst({
            where: { email: bouncedEmail.toLowerCase() },
          });
          expect(suppressed).toMatchObject({ reason: "hard_bounce" });

          const delivery = yield* db.query.emailDeliveryTable.findFirst({
            where: { id: deliveryId },
          });
          expect(delivery?.bouncedAt).not.toBeNull();
          expect(delivery?.complainedAt).toBeNull();

          // Idempotent: replaying the event is a no-op.
          yield* repository.recordBounceOrComplaint({
            email: bouncedEmail,
            messageId,
            type: "hard_bounce",
          });
          const deliveries = yield* db.query.emailDeliveryTable.findMany({
            where: { id: deliveryId },
          });
          expect(deliveries).toHaveLength(1);
        })
    );

    it("verifies the shared-secret HMAC signature", () => {
      const body = JSON.stringify({ events: [] });
      const secret = "test-webhook-secret";
      const good = `sha256=${createHmac("sha256", secret)
        .update(body)
        .digest("hex")}`;

      expect(verifySignature(body, secret, good)).toBe(true);
      expect(verifySignature(body, secret, "sha256=deadbeef")).toBe(false);
      expect(verifySignature(body, secret, undefined)).toBe(false);
      expect(verifySignature(body, "wrong-secret", good)).toBe(false);
    });
  });

  layer(TestLayer)("delivery health", (it) => {
    it.effect("reports last successful send and recent failures", () =>
      Effect.gen(function* () {
        yield* resetTestMailer();
        const fixture = yield* makeFixture([
          `actor-${crypto.randomUUID()}@acme.test`,
          `sub-${crypto.randomUUID()}@acme.test`,
        ]);
        const suffix = fixture.organizationId.split("_").at(-1);
        assert(suffix);
        const inProgressId = `status_in_progress_${suffix}`;
        const db = yield* Database.Database;

        const health = yield* EmailHealthService;
        const before = yield* health.health();
        expect(before.recentFailedEvents).toBe(0);

        const repository = yield* EmailEventRepository;
        const { eventId } = yield* enqueueChange(
          fixture,
          fixture.statusId,
          inProgressId
        );
        yield* repository.scheduleEvent(eventId, fixture.organizationId);
        yield* Effect.yieldNow;
        yield* TestClock.adjust("15 minutes");
        yield* Effect.exit(
          PostStatusChangedEmailWorkflow.execute({
            eventId,
            organizationId: fixture.organizationId,
          })
        );

        const after = yield* health.health();
        expect(after.lastSuccessfulSendAt).not.toBeNull();
        expect(after.recentFailedEvents).toBe(0);

        // A dead-lettered event shows up in the failure count.
        yield* db.insert(schema.emailEventTable).values({
          id: `dead_${suffix}`,
          kind: "post_status_changed",
          organizationId: fixture.organizationId,
          payload: {
            kind: "post_status_changed",
            organizationId: fixture.organizationId,
            postId: fixture.postId,
            postTitle: "Dead",
            postUrl: "https://app.feeblo.com",
            actorMemberId: null,
            actorUserId: null,
            changes: [],
          },
          dedupeKey: `dead_${suffix}`,
          status: "failed",
          createdAt: new Date(),
        });
        const afterFailure = yield* health.health();
        expect(afterFailure.recentFailedEvents).toBe(1);

        return yield* health.checkAndAlert();
      })
    );
  });
});
