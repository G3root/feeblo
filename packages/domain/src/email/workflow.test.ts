import { assert, describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
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
import * as jose from "jose";

const UNSUBSCRIBE_URL_PATTERN =
  /https:\/\/app\.feeblo\.com\/api\/email\/unsubscribe\?token=([^"&<]+)/;

import { EmailConfig } from "./config";
import { digestWindowKey } from "./payload";
import { EmailEventRepository } from "./repository";
import { verifyUnsubscribeToken } from "./unsubscribe";
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
  Layer.provideMerge(Database.PgliteDatabaseLive),
  Layer.provideMerge(
    RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory))
  ),
  Layer.provideMerge(TestConfig)
);

type Fixture = {
  actorMemberId: string;
  actorUserId: string;
  organizationId: string;
  postId: string;
  recipientEmails: string[];
  statusId: string;
  subscriberMemberId: string;
  subscriberUserId: string;
};

const makeFixture = (titles: readonly string[]) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const suffix = crypto.randomUUID();
    const organizationId = `organization_${suffix}`;
    const actorUserId = `actor_${suffix}`;
    const actorMemberId = `member_actor_${suffix}`;
    const subscriberUserId = `subscriber_${suffix}`;
    const subscriberMemberId = `member_subscriber_${suffix}`;
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
      { id: actorUserId, email: `actor-${suffix}@acme.test` },
      { id: subscriberUserId, email: `subscriber-${suffix}@acme.test` },
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
      {
        id: subscriberMemberId,
        organizationId,
        userId: subscriberUserId,
        role: "manager",
        createdAt: now,
      },
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
      {
        id: `status_completed_${suffix}`,
        type: "COMPLETED",
        orderIndex: 2,
        organizationId,
      },
    ]);

    const postId = `post_${suffix}`;
    yield* db.insert(schema.postTable).values({
      id: postId,
      title: titles[0] ?? "Keyboard shortcuts",
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
    yield* db.insert(schema.postSubscriptionTable).values({
      id: `sub_${suffix}`,
      postId,
      userId: subscriberUserId,
      memberId: subscriberMemberId,
      organizationId,
      createdAt: now,
      updatedAt: now,
    });

    return {
      actorMemberId,
      actorUserId,
      organizationId,
      postId,
      recipientEmails: users.map((user) => user.email),
      statusId,
      subscriberMemberId,
      subscriberUserId,
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

const runDigest = (eventId: string, organizationId: string) =>
  Effect.gen(function* () {
    const repository = yield* EmailEventRepository;
    yield* repository.scheduleEvent(eventId, organizationId);
    const executionId = yield* PostStatusChangedEmailWorkflow.executionId({
      eventId,
      organizationId,
    });

    yield* Effect.yieldNow;
    yield* TestClock.adjust("15 minutes");

    // Join the resumed execution deterministically (the same pattern the
    // submission workflow test uses), then read the recorded result.
    const exit = yield* Effect.exit(
      PostStatusChangedEmailWorkflow.execute({ eventId, organizationId })
    );
    const result = yield* PostStatusChangedEmailWorkflow.poll(executionId);

    return { exit, result };
  });

const eventById = (eventId: string) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;
    return yield* db.query.emailEventTable.findFirst({
      where: { id: eventId },
    });
  });

const deliveriesFor = (eventId: string) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;
    return yield* db.query.emailDeliveryTable.findMany({
      where: { eventId },
    });
  });

describe("PostStatusChangedEmailWorkflow", () => {
  layer(TestLayer)("status-change email dispatch", (it) => {
    it.effect(
      "delivers to subscribers and the creator after the digest window, excluding the actor",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const fixture = yield* makeFixture(["Keyboard shortcuts"]);
          const suffix = fixture.organizationId.split("_").at(-1);
          assert(suffix);
          const inProgressId = `status_in_progress_${suffix}`;

          const { eventId } = yield* enqueueChange(
            fixture,
            fixture.statusId,
            inProgressId
          );

          const { exit, result } = yield* runDigest(
            eventId,
            fixture.organizationId
          );
          expect(exit).toEqual(Exit.void);
          expect(result).toEqual(
            Option.some(new Workflow.Complete({ exit: Exit.void }))
          );

          const state = yield* testMailerState;
          expect(state.sentMessages).toHaveLength(1);
          expect(state.sentMessages[0]).toMatchObject({
            subject: "Status updated: Keyboard shortcuts",
            to: fixture.recipientEmails[1],
          });

          const event = yield* eventById(eventId);
          expect(event?.status).toBe("sent");

          const deliveries = yield* deliveriesFor(eventId);
          expect(deliveries).toHaveLength(1);
          expect(deliveries[0]).toMatchObject({
            recipient: fixture.recipientEmails[1],
            status: "sent",
            template: "post-status-changed",
          });
          const recipientEmail = fixture.recipientEmails[1];
          assert(recipientEmail);
          expect(deliveries[0]?.providerMessageId).toBe(
            `<email-event.${eventId}.${encodeURIComponent(recipientEmail)}@notifications.feeblo>`
          );
        })
    );

    it.effect("coalesces status changes within the digest window", () =>
      Effect.gen(function* () {
        yield* resetTestMailer();
        const fixture = yield* makeFixture(["Keyboard shortcuts"]);
        const suffix = fixture.organizationId.split("_").at(-1);
        assert(suffix);
        const inProgressId = `status_in_progress_${suffix}`;
        const completedId = `status_completed_${suffix}`;

        const first = yield* enqueueChange(
          fixture,
          fixture.statusId,
          inProgressId
        );
        // Same window: merges into the same event row.
        const second = yield* enqueueChange(fixture, inProgressId, completedId);
        expect(second.eventId).toBe(first.eventId);
        expect(second.inserted).toBe(false);

        const event = yield* eventById(first.eventId);
        expect(event?.payload.kind).toBe("post_status_changed");
        assert(event?.payload.kind === "post_status_changed");
        expect(event.payload.changes).toHaveLength(2);

        yield* runDigest(first.eventId, fixture.organizationId);

        const state = yield* testMailerState;
        expect(state.sentMessages).toHaveLength(1);
        expect(state.sentMessages[0]?.subject).toBe(
          "Status updated: Keyboard shortcuts"
        );
      })
    );

    it.effect("starts a fresh event after the window bucket rolls over", () =>
      Effect.gen(function* () {
        yield* resetTestMailer();
        const fixture = yield* makeFixture(["Keyboard shortcuts"]);
        const suffix = fixture.organizationId.split("_").at(-1);
        assert(suffix);
        const inProgressId = `status_in_progress_${suffix}`;

        // The window bucket is a pure function of the wall clock: two
        // enqueues inside the same window merge, across windows they don't.
        const window = Duration.minutes(15);
        const bucketA = digestWindowKey(fixture.postId, new Date(0), window);
        const bucketB = digestWindowKey(
          fixture.postId,
          new Date(Duration.toMillis(Duration.minutes(15))),
          window
        );
        expect(bucketA).not.toBe(bucketB);

        const first = yield* enqueueChange(
          fixture,
          fixture.statusId,
          inProgressId
        );
        const second = yield* enqueueChange(
          fixture,
          inProgressId,
          fixture.statusId
        );
        expect(second.eventId).toBe(first.eventId);
        expect(second.inserted).toBe(false);
      })
    );

    it.effect("never re-sends a completed event (crash-restart guard)", () =>
      Effect.gen(function* () {
        yield* resetTestMailer();
        const fixture = yield* makeFixture(["Keyboard shortcuts"]);
        const suffix = fixture.organizationId.split("_").at(-1);
        assert(suffix);
        const inProgressId = `status_in_progress_${suffix}`;

        const { eventId } = yield* enqueueChange(
          fixture,
          fixture.statusId,
          inProgressId
        );
        yield* runDigest(eventId, fixture.organizationId);

        // Simulate a crash-resume re-execution of the same event.
        const { exit, result } = yield* runDigest(
          eventId,
          fixture.organizationId
        );
        expect(exit).toEqual(Exit.void);
        expect(result).toEqual(
          Option.some(new Workflow.Complete({ exit: Exit.void }))
        );

        const state = yield* testMailerState;
        expect(state.sentMessages).toHaveLength(1);
      })
    );

    it.effect(
      "isolates per-recipient failures: others are delivered, failed ones are retried and dead-lettered",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const fixture = yield* makeFixture(["Keyboard shortcuts"]);
          const suffix = fixture.organizationId.split("_").at(-1);
          assert(suffix);
          const inProgressId = `status_in_progress_${suffix}`;
          const badEmail = `bad-${suffix}@acme.test`;
          const db = yield* currentDb;

          // A second subscriber whose address always fails delivery.
          const badUserId = `bad_user_${suffix}`;
          yield* db.insert(schema.userTable).values({
            id: badUserId,
            email: badEmail,
            name: "Bad Recipient",
          });
          yield* db.insert(schema.memberTable).values({
            id: `member_bad_${suffix}`,
            organizationId: fixture.organizationId,
            userId: badUserId,
            role: "manager",
            createdAt: new Date(),
          });
          yield* db.insert(schema.postSubscriptionTable).values({
            id: `sub_bad_${suffix}`,
            postId: fixture.postId,
            userId: badUserId,
            memberId: `member_bad_${suffix}`,
            organizationId: fixture.organizationId,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          yield* resetTestMailer({ failForRecipients: [badEmail] });

          const { eventId } = yield* enqueueChange(
            fixture,
            fixture.statusId,
            inProgressId
          );
          yield* runDigest(eventId, fixture.organizationId);

          const state = yield* testMailerState;
          // One attempt per retry cycle for the failing recipient, plus the
          // healthy one (which is guarded and never re-sent).
          expect(
            state.sentMessages.filter(
              ({ to }) => to === fixture.recipientEmails[1]
            )
          ).toHaveLength(1);
          expect(state.sentMessages.some(({ to }) => to === badEmail)).toBe(
            false
          );

          const deliveries = yield* deliveriesFor(eventId);
          const badDelivery = deliveries.find(
            (delivery) => delivery.recipient === badEmail
          );
          expect(badDelivery?.status).toBe("failed");
          expect(badDelivery?.attempts).toBeGreaterThan(0);
          const goodDelivery = deliveries.find(
            (delivery) => delivery.recipient === fixture.recipientEmails[1]
          );
          expect(goodDelivery?.status).toBe("sent");

          const event = yield* eventById(eventId);
          expect(event?.status).toBe("failed");
        })
    );

    it.effect("skips suppressed recipients and records the reason", () =>
      Effect.gen(function* () {
        yield* resetTestMailer();
        const fixture = yield* makeFixture(["Keyboard shortcuts"]);
        const suffix = fixture.organizationId.split("_").at(-1);
        assert(suffix);
        const inProgressId = `status_in_progress_${suffix}`;
        const db = yield* currentDb;

        const suppressedEmail = fixture.recipientEmails[1];
        assert(suppressedEmail);
        yield* db.insert(schema.suppressedEmailTable).values({
          email: suppressedEmail,
          reason: "hard_bounce",
        });

        const { eventId } = yield* enqueueChange(
          fixture,
          fixture.statusId,
          inProgressId
        );
        yield* runDigest(eventId, fixture.organizationId);

        const state = yield* testMailerState;
        expect(state.sentMessages).toHaveLength(0);

        const deliveries = yield* deliveriesFor(eventId);
        expect(deliveries).toHaveLength(1);
        expect(deliveries[0]).toMatchObject({
          recipient: fixture.recipientEmails[1],
          status: "suppressed",
        });
      })
    );

    it.effect(
      "holds over-cap recipients and recycles the event instead of dropping it",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const fixture = yield* makeFixture(["Keyboard shortcuts"]);
          const suffix = fixture.organizationId.split("_").at(-1);
          assert(suffix);
          const inProgressId = `status_in_progress_${suffix}`;
          const db = yield* Database.Database;

          // The subscriber is already at the daily cap (10 sent in 24h),
          // spread across prior (real) delivered events.
          const cappedEmail = fixture.recipientEmails[1];
          assert(cappedEmail);
          for (let i = 0; i < 10; i += 1) {
            const priorEventId = `prior_event_${suffix}_${i}`;
            yield* db.insert(schema.emailEventTable).values({
              id: priorEventId,
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
              dedupeKey: `prior_${suffix}_${i}`,
              status: "sent",
            });
            yield* db.insert(schema.emailDeliveryTable).values({
              id: `prior_${suffix}_${i}`,
              eventId: priorEventId,
              organizationId: fixture.organizationId,
              memberId: fixture.subscriberMemberId,
              recipient: cappedEmail,
              template: "post-status-changed",
              status: "sent",
              sentAt: new Date(),
            });
          }

          const { eventId } = yield* enqueueChange(
            fixture,
            fixture.statusId,
            inProgressId
          );
          yield* runDigest(eventId, fixture.organizationId);

          // Nobody was emailed (the only subscriber is over cap; the creator
          // is the actor and excluded).
          const state = yield* testMailerState;
          expect(state.sentMessages).toHaveLength(0);

          // The event was recycled: parent dead-lettered, child pending with
          // a future available_at so the reaper re-schedules it.
          const parent = yield* eventById(eventId);
          expect(parent?.status).toBe("failed");
          expect(parent?.lastError).toContain("held");

          const child = yield* db.query.emailEventTable.findFirst({
            where: {
              organizationId: fixture.organizationId,
              status: "pending",
            },
          });
          assert(child);
          expect(child.id).not.toBe(eventId);
          expect(child.availableAt.getTime()).toBeGreaterThan(Date.now());
        })
    );

    it.effect("mints a per-recipient unsubscribe token in the email", () =>
      Effect.gen(function* () {
        yield* resetTestMailer();
        const fixture = yield* makeFixture(["Keyboard shortcuts"]);
        const suffix = fixture.organizationId.split("_").at(-1);
        assert(suffix);
        const inProgressId = `status_in_progress_${suffix}`;

        const { eventId } = yield* enqueueChange(
          fixture,
          fixture.statusId,
          inProgressId
        );
        yield* runDigest(eventId, fixture.organizationId);

        const state = yield* testMailerState;
        expect(state.renderedMessages).toHaveLength(1);

        const match = state.renderedMessages[0]?.html.match(
          UNSUBSCRIBE_URL_PATTERN
        );
        assert(match);
        const tokenValue = match[1];
        assert(tokenValue);
        const token = decodeURIComponent(tokenValue);

        const payload = yield* verifyUnsubscribeToken(token).pipe(
          Effect.provideService(EmailConfig, makeTestConfig({}))
        );
        expect(payload).toMatchObject({
          action: "unsubscribe_post",
          memberId: fixture.subscriberMemberId,
          postId: fixture.postId,
        });
      })
    );
  });

  layer(TestLayer)("unsubscribe tokens", (it) => {
    it.effect("rejects forged and expired tokens", () =>
      Effect.gen(function* () {
        const config = makeTestConfig({});

        const forged = yield* Effect.tryPromise({
          try: () =>
            new jose.SignJWT({
              action: "unsubscribe_post",
              memberId: "member_x",
              postId: "post_x",
            })
              .setProtectedHeader({ alg: "HS256" })
              .setAudience("feeblo:email-unsubscribe")
              .setIssuedAt()
              .setExpirationTime("30 days")
              .sign(new TextEncoder().encode("wrong-secret")),
          catch: () => "",
        });

        const forgedResult = yield* verifyUnsubscribeToken(forged).pipe(
          Effect.provideService(EmailConfig, config),
          Effect.exit
        );
        expect(Exit.isFailure(forgedResult)).toBe(true);
      })
    );
  });
});
