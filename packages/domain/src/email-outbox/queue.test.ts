import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  EmailContactId,
  EmailSubscriptionId,
  MemberId,
  PostId,
  UserId,
  WorkspaceId,
} from "@feeblo/id";
import {
  MailerTestLayer,
  resetTestMailer,
  testMailerState,
} from "@feeblo/transactional/mailer/test";
import { and, eq } from "drizzle-orm";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { TestClock } from "effect/testing";
import * as PersistedQueue from "effect/unstable/persistence/PersistedQueue";

import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { EmailSubscriptionTokenService } from "../email-subscription/tokens";
import { EntitlementPolicy } from "../entitlement/policies";
import { WorkspaceRepository } from "../workspace/repository";
import { EmailOutboxConfig } from "./config";
import {
  emailSubscriptionTopicForIntent,
  resolveSubscriptionNotificationContent,
} from "./content";
import {
  EmailOutboxQueues,
  EmailOutboxWorkerLayer,
  deliverEmailDelivery,
  dispatchEmailOutboxIntent,
  materializeEmailIntent,
  reconcileEmailOutbox,
} from "./queue";
import { EmailOutboxRepository } from "./repository";

// The worker layer runs for real: `waitForDelivery` polls with `yieldNow`, so
// it depends on the take loops progressing concurrently, exactly as the
// in-memory workflow engine did before. `deliverEmailDelivery` is still called
// directly where a test wants one deterministic attempt.
const makeTestLayer = (
  controls: Parameters<typeof EmailOutboxConfig.layerTest>[2] = {}
) =>
  EmailOutboxWorkerLayer.pipe(
    Layer.provideMerge(EmailOutboxQueues.layer),
    Layer.provideMerge(
      EmailOutboxConfig.layerTest(
        new URL("https://test.feeblo.example"),
        undefined,
        controls
      )
    ),
    Layer.provideMerge(MailerTestLayer),
    Layer.provideMerge(EmailOutboxRepository.layer),
    Layer.provideMerge(
      EmailSubscriptionRepository.layerWithoutDependencies.pipe(
        Layer.provide(
          EmailSubscriptionTokenService.layerTest(
            "email-outbox-workflow-test-signing-secret"
          )
        )
      )
    ),
    Layer.provideMerge(
      EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer))
    ),
    Layer.provideMerge(
      PersistedQueue.layer.pipe(Layer.provide(PersistedQueue.layerStoreMemory))
    ),
    Layer.provideMerge(Database.PgliteDatabaseLive)
  );

const TestLayer = makeTestLayer();

/**
 * The instant every test pins `TestClock` to.
 *
 * Fixtures read "now" through `DateTime.nowAsDate`, so row timestamps and the
 * clock the code under test reads are the same instant. Constants that must
 * stay fixed regardless of a test adjusting the clock (an expiry, a consent
 * instant) use this value directly.
 */
const fixtureNow = new Date("2026-08-11T00:00:00.000Z");

/** `date` moved by `duration`, shaped as the `Date` Drizzle columns expect. */
const shiftDate = (date: Date, duration: Duration.Input): Date =>
  DateTime.toDateUtc(
    DateTime.addDuration(DateTime.fromDateUnsafe(date), duration)
  );

const fixture = Effect.gen(function* () {
  const db = yield* currentDb;
  const now = fixtureNow;
  yield* TestClock.setTime(now.getTime());
  const organizationId = yield* WorkspaceId.generate;
  const userId = `usr_${organizationId}`;
  const ownerId = `mem_${organizationId}`;
  const boardId = `brd_${organizationId}`;
  const statusId = `pst_${organizationId}`;
  const postId = `post_${organizationId}`;
  yield* db.insert(schema.organizationTable).values({
    id: organizationId,
    name: "Outbox",
    slug: organizationId,
    createdAt: now,
  });
  yield* db.insert(schema.siteTable).values({
    id: `site_${organizationId}`,
    name: "Outbox site",
    subdomain: `outbox-${organizationId}`,
    customDomain: null,
    changelogVisibility: "PUBLIC",
    roadmapVisibility: "PUBLIC",
    hidePoweredBy: false,
    organizationId,
    createdAt: now,
    updatedAt: now,
  });
  const ownerEmail = `owner-${organizationId}@example.test`;
  yield* db.insert(schema.userTable).values({
    id: userId,
    email: ownerEmail,
    name: "Owner",
    emailVerified: true,
  });
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
  return {
    boardId,
    intentId: intent.intent.id,
    organizationId,
    ownerEmail,
    ownerMemberId: ownerId,
    postId,
    statusId,
    userId,
  };
});

/** A second submission on the fixture's board, for window-coalescing tests. */
const addSubmissionPost = (args: {
  readonly boardId: string;
  readonly organizationId: string;
  readonly ownerMemberId: string;
  readonly postId: string;
  readonly slug: string;
  readonly statusId: string;
  readonly title: string;
  readonly userId: string;
}) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    yield* db.insert(schema.postTable).values({
      id: args.postId,
      organizationId: args.organizationId,
      boardId: args.boardId,
      statusId: args.statusId,
      title: args.title,
      slug: args.slug,
      content: "x",
      excerpt: "x",
      creatorId: args.userId,
      creatorMemberId: args.ownerMemberId,
      createdAt: fixtureNow,
      updatedAt: fixtureNow,
    });
  });

const enableSubscriberEmails = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const now = yield* DateTime.nowAsDate;
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
      currentPeriodEnd: shiftDate(now, Duration.days(1)),
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
  readonly topicType: "changelog" | "post" | "submission";
  /** Links the email contact to a feeblo user (on-behalf attribution). */
  readonly userId?: string | null;
}) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const now = yield* DateTime.nowAsDate;
    const contactId = yield* EmailContactId.generate;
    const subscriptionId = yield* EmailSubscriptionId.generate;
    yield* db
      .insert(schema.emailContactTable)
      .values({
        id: contactId,
        organizationId: args.organizationId,
        userId: args.userId ?? null,
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
    // A second subscription for the same address reuses the existing contact
    // ((organization_id, email) is unique); the ignored insert above leaves
    // our generated id unused in that case.
    const [existingContact] = yield* db
      .select({
        id: schema.emailContactTable.id,
        userId: schema.emailContactTable.userId,
      })
      .from(schema.emailContactTable)
      .where(
        and(
          eq(schema.emailContactTable.organizationId, args.organizationId),
          eq(schema.emailContactTable.email, args.email)
        )
      )
      .limit(1);

    let effectiveContactId = existingContact?.id ?? contactId;

    // Attribution must stay consistent on the conflict path: an unlinked
    // existing contact adopts the requested user; a contact already owned by
    // a different user is a fixture bug and fails loudly.
    if (args.userId && existingContact) {
      if (existingContact.userId === null) {
        yield* db
          .update(schema.emailContactTable)
          .set({ userId: args.userId, updatedAt: yield* DateTime.nowAsDate })
          .where(eq(schema.emailContactTable.id, effectiveContactId));
      } else if (existingContact.userId !== args.userId) {
        return yield* Effect.die(
          `addSubscriptionContact: ${args.email} is already linked to ${existingContact.userId}, not ${args.userId}`
        );
      }
    }

    yield* db.insert(schema.emailSubscriptionTable).values({
      id: subscriptionId,
      organizationId: args.organizationId,
      contactId: effectiveContactId,
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
    return { contactId: effectiveContactId, subscriptionId };
  });

/** Inserts `count` active verified changelog subscribers in two bulk writes. */
const addChangelogSubscribers = (organizationId: string, count: number) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const now = yield* DateTime.nowAsDate;
    const rows = yield* Effect.forEach(
      Array.from({ length: count }, (_, index) => index),
      (index) =>
        Effect.gen(function* () {
          const contactId = yield* EmailContactId.generate;
          const subscriptionId = yield* EmailSubscriptionId.generate;
          return {
            contactId,
            // Deliveries normalize recipient emails, so the contact must be
            // stored lowercased or the materialization join cannot see the
            // deliveries it already created.
            email:
              `batch-${index}-${organizationId}@example.test`.toLowerCase(),
            subscriptionId,
          };
        })
    );
    yield* db.insert(schema.emailContactTable).values(
      rows.map(({ contactId, email }) => ({
        id: contactId,
        organizationId,
        userId: null,
        email,
        verificationState: "verified" as const,
        verifiedAt: now,
        createdAt: now,
        updatedAt: now,
      }))
    );
    yield* db.insert(schema.emailSubscriptionTable).values(
      rows.map(({ contactId, subscriptionId }) => ({
        id: subscriptionId,
        organizationId,
        contactId,
        topicType: "changelog" as const,
        topicId: null,
        source: "explicit" as const,
        state: "active" as const,
        verificationTokenHash: null,
        verificationExpiresAt: null,
        unsubscribeTokenHash: "previous-token-hash",
        verifiedAt: now,
        unsubscribedAt: null,
        createdAt: now,
        updatedAt: now,
      }))
    );
  });

const waitForDelivery = (
  outboxId: string,
  predicate: (
    delivery: typeof schema.emailDeliveryTable.$inferSelect
  ) => boolean
) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;
    let lastObservedState = "missing";
    let lastObservedAttemptCount = 0;
    for (let poll = 0; poll < 100; poll += 1) {
      const [delivery] = yield* db
        .select()
        .from(schema.emailDeliveryTable)
        .where(eq(schema.emailDeliveryTable.outboxId, outboxId));
      if (delivery !== undefined && predicate(delivery)) {
        return delivery;
      }
      lastObservedState = delivery?.state ?? "missing";
      lastObservedAttemptCount = delivery?.attemptCount ?? 0;
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(
      `Email delivery did not reach the expected state; last state=${lastObservedState}, attempts=${lastObservedAttemptCount}`
    );
  });

const waitForIntentState = (outboxId: string, state: string) =>
  Effect.gen(function* () {
    const repository = yield* EmailOutboxRepository;
    let lastObserved = "missing";
    for (let poll = 0; poll < 100; poll += 1) {
      lastObserved = (yield* repository.findById(outboxId))?.state ?? "missing";
      if (lastObserved === state) {
        return;
      }
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(
      `Email intent did not reach ${state}; last observed ${lastObserved}`
    );
  });

/**
 * Waits until an intent has left the pending states and every delivery it
 * produced has stopped moving through the outbox.
 *
 * `accepted` still accepts provider feedback, but the outbox will not send it
 * again, so it counts as settled here. The suite shares one worker layer, so a
 * test that leaves sends in flight leaks them into the next test's mailer
 * outcomes.
 */
const waitForOutboxToSettle = (outboxId: string) =>
  Effect.gen(function* () {
    const repository = yield* EmailOutboxRepository;
    const db = yield* Database.Database;
    for (let poll = 0; poll < 100_000; poll += 1) {
      const intent = yield* repository.findById(outboxId);
      if (
        intent !== undefined &&
        (intent.state === "pending" || intent.state === "paused_by_plan")
      ) {
        yield* Effect.yieldNow;
        continue;
      }
      const rows = yield* db
        .select({ state: schema.emailDeliveryTable.state })
        .from(schema.emailDeliveryTable)
        .where(eq(schema.emailDeliveryTable.outboxId, outboxId));
      if (
        rows.every(
          (row) =>
            row.state !== "queued" &&
            row.state !== "deferred" &&
            row.state !== "sending" &&
            row.state !== "paused_by_plan"
        )
      ) {
        return;
      }
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(`Outbox ${outboxId} did not settle`);
  });

describe("EmailOutbox workflows", () => {
  layer(TestLayer)("in-memory persisted queue", (it) => {
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

    it.effect("coalesces submissions in one window into a single email", () =>
      Effect.gen(function* () {
        yield* resetTestMailer();
        const {
          boardId,
          intentId,
          organizationId,
          ownerMemberId,
          statusId,
          userId,
        } = yield* fixture;
        const repository = yield* EmailOutboxRepository;
        const db = yield* Database.Database;
        const secondPostId = yield* PostId.generate;
        yield* addSubmissionPost({
          boardId,
          organizationId,
          ownerMemberId,
          postId: secondPostId,
          slug: "second-submission",
          statusId,
          title: "Second submission",
          userId,
        });

        // The fixture writes the pre-window single-post intent shape, so this
        // also covers a window that was pending across the change.
        const appended = yield* repository.upsertPendingSubmissionWindow({
          now: fixtureNow,
          organizationId,
          postId: secondPostId,
        });
        expect(appended).toEqual({ _tag: "Written", intentId });

        // The appended post slid the window five minutes out; nothing sends
        // until the burst has been quiet that long.
        expect(yield* materializeEmailIntent(intentId)).toEqual([]);
        yield* TestClock.adjust("5 minutes");

        const deliveryIds = yield* materializeEmailIntent(intentId);
        expect(deliveryIds).toHaveLength(1);
        yield* Effect.forEach(deliveryIds, (deliveryId) =>
          deliverEmailDelivery({ deliveryId })
        );

        const state = yield* testMailerState;
        expect(state.sentMessages).toHaveLength(1);
        expect(state.sentMessages[0]?.subject).toBe(
          "2 new submissions in your workspace"
        );
        const [delivery] = yield* db
          .select({
            templatePayload: schema.emailDeliveryTable.templatePayload,
          })
          .from(schema.emailDeliveryTable)
          .where(eq(schema.emailDeliveryTable.outboxId, intentId));
        expect(delivery?.templatePayload).toMatchObject({
          body: "2 new posts have been submitted.",
          posts: [
            {
              label: "Ship email outbox",
              url: expect.stringContaining("feedback/ship-email-outbox"),
            },
            {
              label: "Second submission",
              url: expect.stringContaining("feedback/second-submission"),
            },
          ],
        });
      })
    );

    it.effect("summarises a window past its stored id cap", () =>
      Effect.gen(function* () {
        yield* resetTestMailer();
        const { intentId, postId } = yield* fixture;
        const db = yield* Database.Database;
        // A window that reached its stored id cap and kept counting: the email
        // reports the volume it cannot render rather than understating it.
        yield* db
          .update(schema.emailOutboxTable)
          .set({
            payload: {
              kind: "submission.created",
              postCount: 350,
              postIds: [postId],
            },
          })
          .where(eq(schema.emailOutboxTable.id, intentId));

        const deliveryIds = yield* materializeEmailIntent(intentId);
        expect(deliveryIds).toHaveLength(1);
        yield* Effect.forEach(deliveryIds, (deliveryId) =>
          deliverEmailDelivery({ deliveryId })
        );

        const state = yield* testMailerState;
        expect(state.sentMessages[0]?.subject).toBe(
          "350 new submissions in your workspace"
        );
        const [delivery] = yield* db
          .select({
            templatePayload: schema.emailDeliveryTable.templatePayload,
          })
          .from(schema.emailDeliveryTable)
          .where(eq(schema.emailDeliveryTable.outboxId, intentId));
        expect(delivery?.templatePayload).toMatchObject({
          body: "350 new posts have been submitted.",
          posts: [
            { label: "Ship email outbox" },
            { label: "and 349 more submitted posts" },
          ],
        });
      })
    );

    it.effect(
      "reports a capped window whose stored posts were all deleted",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { intentId, postId } = yield* fixture;
          const db = yield* Database.Database;
          // The window reached its stored id cap and kept counting; every post it
          // tracked has since been deleted. The four submissions it still counts
          // are real and must not go unreported.
          yield* db
            .update(schema.emailOutboxTable)
            .set({
              payload: {
                kind: "submission.created",
                postCount: 5,
                postId,
                postIds: [postId],
              },
            })
            .where(eq(schema.emailOutboxTable.id, intentId));
          yield* db
            .delete(schema.postTable)
            .where(eq(schema.postTable.id, postId));

          const deliveryIds = yield* materializeEmailIntent(intentId);
          expect(deliveryIds).toHaveLength(1);
          // Deliver it rather than leaving a queued row behind: this suite shares
          // one database, and a later reconciliation would offer it to a worker
          // whose send lands in another test's mailbox assertion.
          yield* Effect.forEach(deliveryIds, (deliveryId) =>
            deliverEmailDelivery({ deliveryId })
          );
          const [delivery] = yield* db
            .select({
              templatePayload: schema.emailDeliveryTable.templatePayload,
            })
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.outboxId, intentId));
          expect(delivery?.templatePayload).toMatchObject({
            body: "4 new posts have been submitted.",
            posts: [{ label: "and 4 more submitted posts" }],
          });
        })
    );

    it.effect("drops a post deleted before its window sends", () =>
      Effect.gen(function* () {
        yield* resetTestMailer();
        const {
          boardId,
          intentId,
          organizationId,
          ownerMemberId,
          statusId,
          userId,
        } = yield* fixture;
        const repository = yield* EmailOutboxRepository;
        const db = yield* Database.Database;
        const deletedPostId = yield* PostId.generate;
        yield* addSubmissionPost({
          boardId,
          organizationId,
          ownerMemberId,
          postId: deletedPostId,
          slug: "deleted-submission",
          statusId,
          title: "Deleted submission",
          userId,
        });
        yield* repository.upsertPendingSubmissionWindow({
          now: fixtureNow,
          organizationId,
          postId: deletedPostId,
        });
        yield* db
          .delete(schema.postTable)
          .where(eq(schema.postTable.id, deletedPostId));
        yield* TestClock.adjust("5 minutes");

        const deliveryIds = yield* materializeEmailIntent(intentId);
        expect(deliveryIds).toHaveLength(1);
        // Deliver it rather than leaving a queued row behind: this suite shares
        // one database, and a later reconciliation would offer it to a worker
        // whose send lands in another test's mailbox assertion.
        yield* Effect.forEach(deliveryIds, (deliveryId) =>
          deliverEmailDelivery({ deliveryId })
        );
        const [delivery] = yield* db
          .select({
            templatePayload: schema.emailDeliveryTable.templatePayload,
          })
          .from(schema.emailDeliveryTable)
          .where(eq(schema.emailDeliveryTable.outboxId, intentId));
        expect(delivery?.templatePayload).toMatchObject({
          body: "A new post has been submitted.",
          posts: [{ label: "Ship email outbox" }],
        });
      })
    );

    it.effect("expires a window whose posts were all deleted", () =>
      Effect.gen(function* () {
        yield* resetTestMailer();
        const { intentId, postId } = yield* fixture;
        const repository = yield* EmailOutboxRepository;
        const db = yield* Database.Database;
        yield* db
          .delete(schema.postTable)
          .where(eq(schema.postTable.id, postId));

        expect(yield* materializeEmailIntent(intentId)).toEqual([]);
        expect((yield* repository.findById(intentId))?.state).toBe("expired");
        const deliveries = yield* db
          .select({ id: schema.emailDeliveryTable.id })
          .from(schema.emailDeliveryTable)
          .where(eq(schema.emailDeliveryTable.outboxId, intentId));
        expect(deliveries).toHaveLength(0);
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
      "sends paid submission notifications only to opted-in administrators",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { intentId, organizationId, ownerEmail } = yield* fixture;
          yield* enableSubscriberEmails(organizationId);
          const db = yield* Database.Database;
          const adminUserId = yield* UserId.generate;
          const adminMemberId = yield* MemberId.generate;
          const adminEmail = `admin-${organizationId}@example.test`;
          yield* db.insert(schema.userTable).values({
            id: adminUserId,
            email: adminEmail,
            name: "Opted-in admin",
            emailVerified: true,
          });
          yield* db.insert(schema.memberTable).values({
            id: adminMemberId,
            createdAt: fixtureNow,
            organizationId,
            role: "admin",
            userId: adminUserId,
          });
          yield* (yield* EmailSubscriptionRepository).requestSubscription({
            alreadyVerifiedUser: { userId: adminUserId },
            email: adminEmail,
            now: fixtureNow,
            organizationId,
            source: "explicit",
            topic: { topicId: null, topicType: "submission" },
            verificationExpiresAt: null,
          });

          const deliveryIds = yield* materializeEmailIntent(intentId);
          yield* Effect.forEach(deliveryIds, (deliveryId) =>
            deliverEmailDelivery({ deliveryId })
          );
          const mailbox = yield* testMailerState;
          expect(mailbox.sentMessages.map((message) => message.to)).toEqual([
            adminEmail.toLowerCase(),
          ]);
          expect(
            mailbox.sentMessages.map((message) => message.to)
          ).not.toContain(ownerEmail.toLowerCase());
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
          yield* dispatchEmailOutboxIntent({ outboxId: intentId });
          yield* waitForDelivery(
            intentId,
            (delivery) =>
              delivery.state === "deferred" && delivery.attemptCount === 1
          );
          yield* TestClock.adjust("2 seconds");
          // The worker returns after writing `next_attempt_at`; reconciliation
          // is what re-offers the row once it is due.
          yield* reconcileEmailOutbox();
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
          const subscriptions = yield* EmailSubscriptionRepository;
          const consentNow = fixtureNow;
          const subscriber = yield* subscriptions.requestSubscription({
            email: `changelog-${organizationId}@example.test`,
            now: consentNow,
            organizationId,
            source: "explicit",
            topic: { topicId: null, topicType: "changelog" },
            verificationExpiresAt: shiftDate(consentNow, Duration.days(1)),
          });
          if (Option.isNone(subscriber.verificationToken)) {
            return yield* Effect.die("Expected a verification token");
          }
          yield* subscriptions.verifySubscription({
            now: consentNow,
            verificationToken: Redacted.value(
              subscriber.verificationToken.value
            ),
          });
          const now = yield* DateTime.nowAsDate;
          yield* db.insert(schema.changelogTable).values({
            id: changelogId,
            organizationId,
            title: "New release",
            slug: "new-release",
            content: "Release notes",
            excerpt: "Release notes",
            status: "published",
            publishedAt: now,
            creatorId: null,
            creatorMemberId: null,
            createdAt: now,
            updatedAt: now,
          });
          const intent = yield* (yield* EmailOutboxRepository).recordIntent({
            aggregateId: changelogId,
            aggregateType: "changelog",
            deduplicationKey: `changelog.published:${organizationId}:${changelogId}`,
            expiresAt: null,
            kind: "changelog.published",
            organizationId,
            payload: { kind: "changelog.published", changelogId },
            scheduledAt: now,
          });
          if (intent._tag !== "Inserted") {
            return yield* Effect.die("Expected changelog intent");
          }
          const deliveryIds = yield* materializeEmailIntent(intent.intent.id);
          yield* Effect.forEach(deliveryIds, (deliveryId) =>
            deliverEmailDelivery({ deliveryId })
          );
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
            state.sentMessages[0]?.headers?.["List-Unsubscribe"]?.startsWith(
              "<https://test.feeblo.example/api/email-subscriptions/unsubscribe?token="
            )
          ).toBe(true);
          expect(
            state.sentMessages[0]?.headers?.["List-Unsubscribe-Post"]
          ).toBe("List-Unsubscribe=One-Click");
          const [storedSubscription] = yield* db
            .select({
              unsubscribeTokenHash:
                schema.emailSubscriptionTable.unsubscribeTokenHash,
            })
            .from(schema.emailSubscriptionTable)
            .where(
              eq(schema.emailSubscriptionTable.id, subscriber.subscription.id)
            );
          expect(storedSubscription?.unsubscribeTokenHash).toBeTruthy();
          const [delivery] = yield* db
            .select()
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.outboxId, intent.intent.id));
          expect(delivery?.contactId).toBe(subscriber.contact.id);
          expect(delivery?.template).toBe("changelog");
          expect(delivery?.templatePayload).toMatchObject({
            title: "New release",
            actionUrl: `https://outbox-${organizationId}.test.feeblo.example/changelog/new-release`,
            unsubscribe: {
              kind: "subscription",
              subscriptionId: subscriber.subscription.id,
            },
          });
          const listUnsubscribe =
            state.sentMessages[0]?.headers?.["List-Unsubscribe"];
          if (listUnsubscribe === undefined) {
            return yield* Effect.die("Expected a List-Unsubscribe URL");
          }
          const unsubscribeToken = new URL(
            listUnsubscribe.slice(1, -1)
          ).searchParams.get("token");
          if (unsubscribeToken === null) {
            return yield* Effect.die("Expected an unsubscribe token");
          }
          yield* subscriptions.unsubscribe({
            now: consentNow,
            unsubscribeToken,
          });
          const [unsubscribed] = yield* db
            .select({ state: schema.emailSubscriptionTable.state })
            .from(schema.emailSubscriptionTable)
            .where(
              eq(schema.emailSubscriptionTable.id, subscriber.subscription.id)
            );
          expect(unsubscribed?.state).toBe("unsubscribed");
        })
    );

    it.effect(
      "expires changelog deliveries when the workspace hides its changelog",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { organizationId } = yield* fixture;
          const db = yield* Database.Database;
          yield* enableSubscriberEmails(organizationId);
          const changelogId = `changelog_${organizationId}`;
          const subscriptions = yield* EmailSubscriptionRepository;
          const consentNow = fixtureNow;
          const subscriber = yield* subscriptions.requestSubscription({
            email: `hidden-${organizationId}@example.test`,
            now: consentNow,
            organizationId,
            source: "explicit",
            topic: { topicId: null, topicType: "changelog" },
            verificationExpiresAt: shiftDate(consentNow, Duration.days(1)),
          });
          if (Option.isNone(subscriber.verificationToken)) {
            return yield* Effect.die("Expected a verification token");
          }
          yield* subscriptions.verifySubscription({
            now: consentNow,
            verificationToken: Redacted.value(
              subscriber.verificationToken.value
            ),
          });
          const now = yield* DateTime.nowAsDate;
          yield* db.insert(schema.changelogTable).values({
            id: changelogId,
            organizationId,
            title: "Hidden release",
            slug: "hidden-release",
            content: "Release notes",
            excerpt: "Release notes",
            status: "published",
            publishedAt: now,
            creatorId: null,
            creatorMemberId: null,
            createdAt: now,
            updatedAt: now,
          });
          // The subscriber consented while public; the workspace has since
          // hidden its changelog.
          yield* db
            .update(schema.siteTable)
            .set({
              changelogVisibility: "HIDDEN",
              updatedAt: now,
            })
            .where(eq(schema.siteTable.organizationId, organizationId));
          const intent = yield* (yield* EmailOutboxRepository).recordIntent({
            aggregateId: changelogId,
            aggregateType: "changelog",
            deduplicationKey: `changelog.published:${organizationId}:${changelogId}`,
            expiresAt: null,
            kind: "changelog.published",
            organizationId,
            payload: { kind: "changelog.published", changelogId },
            scheduledAt: now,
          });
          if (intent._tag !== "Inserted") {
            return yield* Effect.die("Expected changelog intent");
          }
          const deliveryIds = yield* materializeEmailIntent(intent.intent.id);
          expect(deliveryIds).toEqual([]);
          const [storedIntent] = yield* db
            .select({ state: schema.emailOutboxTable.state })
            .from(schema.emailOutboxTable)
            .where(eq(schema.emailOutboxTable.id, intent.intent.id));
          expect(storedIntent?.state).toBe("expired");
          const mailer = yield* testMailerState;
          expect(mailer.sentMessages).toHaveLength(0);
        })
    );

    it.effect(
      "suppresses queued changelog deliveries hidden before the send attempt",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { organizationId } = yield* fixture;
          const db = yield* Database.Database;
          yield* enableSubscriberEmails(organizationId);
          const changelogId = `changelog_${organizationId}`;
          const subscriptions = yield* EmailSubscriptionRepository;
          const consentNow = fixtureNow;
          const subscriber = yield* subscriptions.requestSubscription({
            email: `queued-${organizationId}@example.test`,
            now: consentNow,
            organizationId,
            source: "explicit",
            topic: { topicId: null, topicType: "changelog" },
            verificationExpiresAt: shiftDate(consentNow, Duration.days(1)),
          });
          if (Option.isNone(subscriber.verificationToken)) {
            return yield* Effect.die("Expected a verification token");
          }
          yield* subscriptions.verifySubscription({
            now: consentNow,
            verificationToken: Redacted.value(
              subscriber.verificationToken.value
            ),
          });
          const now = yield* DateTime.nowAsDate;
          yield* db.insert(schema.changelogTable).values({
            id: changelogId,
            organizationId,
            title: "Queued release",
            slug: "queued-release",
            content: "Release notes",
            excerpt: "Release notes",
            status: "published",
            publishedAt: now,
            creatorId: null,
            creatorMemberId: null,
            createdAt: now,
            updatedAt: now,
          });
          // Materialize while public: a delivery is queued for the send path.
          const intent = yield* (yield* EmailOutboxRepository).recordIntent({
            aggregateId: changelogId,
            aggregateType: "changelog",
            deduplicationKey: `changelog.published:${organizationId}:${changelogId}`,
            expiresAt: null,
            kind: "changelog.published",
            organizationId,
            payload: { kind: "changelog.published", changelogId },
            scheduledAt: now,
          });
          if (intent._tag !== "Inserted") {
            return yield* Effect.die("Expected changelog intent");
          }
          const deliveryIds = yield* materializeEmailIntent(intent.intent.id);
          const deliveryId = deliveryIds[0];
          if (deliveryId === undefined) {
            return yield* Effect.die("Expected a queued delivery");
          }
          // The workspace hides its changelog after materialization but
          // before the queued delivery is sent.
          yield* db
            .update(schema.siteTable)
            .set({
              changelogVisibility: "HIDDEN",
              updatedAt: yield* DateTime.nowAsDate,
            })
            .where(eq(schema.siteTable.organizationId, organizationId));
          yield* deliverEmailDelivery({ deliveryId });
          const [delivery] = yield* db
            .select({ state: schema.emailDeliveryTable.state })
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.id, deliveryId));
          expect(delivery?.state).toBe("suppressed");
          const mailer = yield* testMailerState;
          expect(mailer.sentMessages).toHaveLength(0);
        })
    );

    it.effect(
      "suppresses a deferred changelog delivery hidden after its first claim",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer({
            outcomes: [{ _tag: "temporaryFailure" }, { _tag: "accepted" }],
          });
          const { organizationId } = yield* fixture;
          const db = yield* Database.Database;
          yield* enableSubscriberEmails(organizationId);
          const changelogId = `changelog_${organizationId}`;
          const subscriptions = yield* EmailSubscriptionRepository;
          const consentNow = fixtureNow;
          const subscriber = yield* subscriptions.requestSubscription({
            email: `deferred-${organizationId}@example.test`,
            now: consentNow,
            organizationId,
            source: "explicit",
            topic: { topicId: null, topicType: "changelog" },
            verificationExpiresAt: shiftDate(consentNow, Duration.days(1)),
          });
          if (Option.isNone(subscriber.verificationToken)) {
            return yield* Effect.die("Expected a verification token");
          }
          yield* subscriptions.verifySubscription({
            now: consentNow,
            verificationToken: Redacted.value(
              subscriber.verificationToken.value
            ),
          });
          const now = yield* DateTime.nowAsDate;
          yield* db.insert(schema.changelogTable).values({
            id: changelogId,
            organizationId,
            title: "Deferred release",
            slug: "deferred-release",
            content: "Release notes",
            excerpt: "Release notes",
            status: "published",
            publishedAt: now,
            creatorId: null,
            creatorMemberId: null,
            createdAt: now,
            updatedAt: now,
          });
          const intent = yield* (yield* EmailOutboxRepository).recordIntent({
            aggregateId: changelogId,
            aggregateType: "changelog",
            deduplicationKey: `changelog.published:${organizationId}:${changelogId}`,
            expiresAt: null,
            kind: "changelog.published",
            organizationId,
            payload: { kind: "changelog.published", changelogId },
            scheduledAt: now,
          });
          if (intent._tag !== "Inserted") {
            return yield* Effect.die("Expected changelog intent");
          }
          const deliveryIds = yield* materializeEmailIntent(intent.intent.id);
          const deliveryId = deliveryIds[0];
          if (deliveryId === undefined) {
            return yield* Effect.die("Expected a queued delivery");
          }
          // The first attempt claims the delivery, renders it, and the
          // provider fails temporarily, deferring the retry. The handler
          // returns without sleeping; reconciliation re-offers it once the
          // row's `next_attempt_at` is due.
          yield* deliverEmailDelivery({ deliveryId });
          yield* waitForDelivery(
            intent.intent.id,
            (delivery) =>
              delivery.state === "deferred" && delivery.attemptCount === 1
          );
          // The workspace hides its changelog while the retry waits.
          yield* db
            .update(schema.siteTable)
            .set({
              changelogVisibility: "HIDDEN",
              updatedAt: yield* DateTime.nowAsDate,
            })
            .where(eq(schema.siteTable.organizationId, organizationId));
          yield* TestClock.adjust("10 seconds");
          yield* reconcileEmailOutbox();
          yield* waitForDelivery(
            intent.intent.id,
            (delivery) => delivery.state === "suppressed"
          );
          // The retry must never reach the provider again.
          const mailer = yield* testMailerState;
          expect(mailer.sentMessages).toHaveLength(0);
          expect(mailer.attempts).toBe(1);
        })
    );

    it.effect(
      "delivers a double-opt-in link without persisting its bearer token",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { organizationId } = yield* fixture;
          yield* enableSubscriberEmails(organizationId);
          const now = fixtureNow;
          const requested =
            yield* (yield* EmailSubscriptionRepository).requestSubscription({
              email: `verify-${organizationId}@example.test`,
              now,
              organizationId,
              source: "explicit",
              topic: { topicId: null, topicType: "changelog" },
              verificationExpiresAt: shiftDate(now, Duration.days(1)),
            });
          const intent = yield* (yield* EmailOutboxRepository).recordIntent({
            aggregateId: requested.subscription.id,
            aggregateType: "email_subscription",
            deduplicationKey: `subscription.verification_requested:${requested.subscription.id}`,
            expiresAt: shiftDate(now, Duration.days(1)),
            kind: "subscription.verification_requested",
            organizationId,
            payload: {
              kind: "subscription.verification_requested",
              subscriptionId: requested.subscription.id,
            },
            scheduledAt: now,
          });
          if (intent._tag !== "Inserted") {
            return yield* Effect.die("Expected verification intent");
          }
          const deliveryIds = yield* materializeEmailIntent(intent.intent.id);
          yield* Effect.forEach(deliveryIds, (deliveryId) =>
            deliverEmailDelivery({ deliveryId })
          );
          yield* waitForDelivery(
            intent.intent.id,
            (delivery) => delivery.state === "accepted"
          );
          const mailbox = yield* testMailerState;
          expect(mailbox.renderedMessages[0]?.html).toContain(
            "https://test.feeblo.example/api/email-subscriptions/verify?token="
          );
          const db = yield* Database.Database;
          const [delivery] = yield* db
            .select({
              templatePayload: schema.emailDeliveryTable.templatePayload,
            })
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.outboxId, intent.intent.id));
          expect(delivery?.templatePayload).toEqual({
            subscriptionId: requested.subscription.id,
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
              scheduledAt: yield* DateTime.nowAsDate,
            });
          if (intent._tag !== "Written") {
            return yield* Effect.die("Expected post intent");
          }
          const deliveryIds = yield* materializeEmailIntent(intent.intent.id);
          yield* Effect.forEach(deliveryIds, (deliveryId) =>
            deliverEmailDelivery({ deliveryId })
          );
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
                eq(schema.emailDeliveryTable.contactId, suppressed.contactId)
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
            expiresAt: shiftDate(fixtureNow, Duration.days(1)),
            kind: "post.closed",
            organizationId,
            payload: { kind: "post.closed", postId },
            scheduledAt: fixtureNow,
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
                unsubscribe: {
                  kind: "subscription",
                  subscriptionId: subscriber.subscriptionId,
                },
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

          yield* deliverEmailDelivery({ deliveryId: delivery.delivery.id });

          expect((yield* testMailerState).attempts).toBe(0);
          expect(
            (yield* (yield* EmailOutboxRepository).findDeliveryById(
              delivery.delivery.id
            ))?.state
          ).toBe("suppressed");
        })
    );

    it.effect(
      "sends an official post update immediately to active post subscribers",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { organizationId } = yield* fixture;
          yield* enableSubscriberEmails(organizationId);
          const postId = `post_${organizationId}`;
          yield* addSubscriptionContact({
            email: `official-${organizationId}@example.test`,
            organizationId,
            state: "active",
            topicId: postId,
            topicType: "post",
          });
          const intent = yield* (yield* EmailOutboxRepository).recordIntent({
            aggregateId: postId,
            aggregateType: "post",
            deduplicationKey: `post.official_update_published:${postId}:test`,
            expiresAt: shiftDate(fixtureNow, Duration.days(1)),
            kind: "post.official_update_published",
            organizationId,
            payload: {
              body: "The requested export is now available.",
              kind: "post.official_update_published",
              postId,
              updateId: `update_${organizationId}`,
            },
            scheduledAt: fixtureNow,
          });
          if (intent._tag !== "Inserted") {
            return yield* Effect.die("Expected official-update intent");
          }
          const deliveryIds = yield* materializeEmailIntent(intent.intent.id);
          yield* Effect.forEach(deliveryIds, (deliveryId) =>
            deliverEmailDelivery({ deliveryId })
          );
          const mailbox = yield* testMailerState;
          expect(mailbox.sentMessages).toHaveLength(1);
          expect(mailbox.renderedMessages[0]?.text).toContain(
            "The requested export is now available."
          );
        })
    );

    it.effect(
      "pauses a subscriber intent on downgrade and reconciles it after upgrade while unexpired",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { intentId, organizationId } = yield* fixture;
          const db = yield* Database.Database;
          const changelogId = `resume_changelog_${organizationId}`;
          const now = yield* DateTime.nowAsDate;
          yield* db.insert(schema.changelogTable).values({
            id: changelogId,
            organizationId,
            title: "Upgrade release",
            slug: "upgrade-release",
            content: "x",
            excerpt: "x",
            status: "published",
            publishedAt: now,
            creatorId: null,
            creatorMemberId: null,
            createdAt: now,
            updatedAt: now,
          });
          const intent = yield* (yield* EmailOutboxRepository).recordIntent({
            aggregateId: changelogId,
            aggregateType: "changelog",
            deduplicationKey: `changelog.resume:${organizationId}:${changelogId}`,
            expiresAt: shiftDate(fixtureNow, Duration.days(1)),
            kind: "changelog.published",
            organizationId,
            payload: { kind: "changelog.published", changelogId },
            scheduledAt: fixtureNow,
          });
          if (intent._tag !== "Inserted") {
            return yield* Effect.die("Expected resumable intent");
          }
          yield* materializeEmailIntent(intent.intent.id);
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
          yield* waitForOutboxToSettle(intent.intent.id);
          yield* waitForOutboxToSettle(intentId);
        })
    );

    it.effect(
      "re-offers a delivery resumed from a plan pause with a fresh element id",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { intentId, organizationId } = yield* fixture;
          const db = yield* Database.Database;
          yield* enableSubscriberEmails(organizationId);
          const changelogId = `delivery_resume_${organizationId}`;
          const now = yield* DateTime.nowAsDate;
          yield* db.insert(schema.changelogTable).values({
            id: changelogId,
            organizationId,
            title: "Delivery resume",
            slug: "delivery-resume",
            content: "x",
            excerpt: "x",
            status: "published",
            publishedAt: now,
            creatorId: null,
            creatorMemberId: null,
            createdAt: now,
            updatedAt: now,
          });
          yield* addSubscriptionContact({
            email: `resume-delivery-${organizationId}@example.test`,
            organizationId,
            state: "active",
            topicId: null,
            topicType: "changelog",
          });
          const intent = yield* (yield* EmailOutboxRepository).recordIntent({
            aggregateId: changelogId,
            aggregateType: "changelog",
            deduplicationKey: `changelog.delivery-resume:${organizationId}:${changelogId}`,
            expiresAt: shiftDate(fixtureNow, Duration.days(1)),
            kind: "changelog.published",
            organizationId,
            payload: { kind: "changelog.published", changelogId },
            scheduledAt: fixtureNow,
          });
          if (intent._tag !== "Inserted") {
            return yield* Effect.die("Expected resumable delivery intent");
          }
          const deliveryIds = yield* materializeEmailIntent(intent.intent.id);
          const deliveryId = deliveryIds[0];
          if (deliveryId === undefined) {
            return yield* Effect.die("Expected a queued delivery");
          }

          // Downgrade: the queued delivery's first attempt parks it on the
          // plan and completes the queue element that carries attempt 0/version 0.
          yield* db
            .update(schema.subscriptionTable)
            .set({ status: "canceled", updatedAt: now })
            .where(eq(schema.subscriptionTable.organizationId, organizationId));
          yield* reconcileEmailOutbox();
          yield* waitForDelivery(
            intent.intent.id,
            (delivery) => delivery.state === "paused_by_plan"
          );

          // Upgrade: reconciliation resumes it. The re-offer must not reuse the
          // completed element id, or the queue would swallow it as a duplicate.
          yield* db
            .update(schema.subscriptionTable)
            .set({ status: "active", updatedAt: now })
            .where(eq(schema.subscriptionTable.organizationId, organizationId));
          yield* reconcileEmailOutbox();
          yield* waitForDelivery(
            intent.intent.id,
            (delivery) => delivery.state === "accepted"
          );
          expect(
            (yield* testMailerState).sentMessages.filter(
              (message) =>
                message.to ===
                `resume-delivery-${organizationId}@example.test`.toLowerCase()
            )
          ).toHaveLength(1);
          yield* waitForOutboxToSettle(intent.intent.id);
          yield* waitForOutboxToSettle(intentId);
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
          yield* dispatchEmailOutboxIntent({ outboxId: intentId });
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
          yield* dispatchEmailOutboxIntent({ outboxId: intentId });
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
          yield* dispatchEmailOutboxIntent({ outboxId: intentId });
          for (const _attempt of [1, 2, 3, 4]) {
            const delivery = yield* waitForDelivery(
              intentId,
              (candidate) =>
                candidate.attemptCount >= _attempt &&
                (candidate.state === "deferred" || candidate.state === "failed")
            );
            if (delivery.state === "failed") {
              break;
            }
            yield* TestClock.adjust("2 hours");
            yield* reconcileEmailOutbox();
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
              unsubscribe: {
                kind: "settings",
                url: "https://app.feeblo.com/settings/notifications",
              },
            },
          });
          if (delivery._tag !== "Inserted") {
            return yield* Effect.die("Expected queued orphan delivery");
          }
          yield* reconcileEmailOutbox();
          // Reconciliation offers the orphan row and a delivery worker takes it;
          // the attempt is asynchronous, so poll rather than assert once.
          yield* waitForDelivery(
            intentId,
            (stored) => stored.state === "accepted"
          );
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
              unsubscribe: {
                kind: "settings",
                url: "https://app.feeblo.com/settings/notifications",
              },
            },
          });
          if (delivery._tag !== "Inserted") {
            return yield* Effect.die("Expected stranded delivery");
          }
          yield* db
            .update(schema.emailDeliveryTable)
            .set({
              state: "sending",
              updatedAt: shiftDate(fixtureNow, Duration.minutes(-10)),
            })
            .where(eq(schema.emailDeliveryTable.id, delivery.delivery.id));

          // The stale `sending` lease makes this attempt wait out
          // `sendingLeaseRecoveryDelayMs`, so fork it; reconciliation releases
          // the lease from the row independently.
          yield* deliverEmailDelivery({
            deliveryId: delivery.delivery.id,
          }).pipe(Effect.forkScoped);
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
      "fails the element when the exhausted-delivery write cannot be persisted",
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
            recipientEmail: `unpersistable-${intentId}@example.test`,
            template: "submission-notification",
            templateVersion: 1,
            templatePayload: {
              actionLabel: "View dashboard",
              actionUrl: "https://app.feeblo.com",
              body: "A new post has been submitted.",
              eyebrow: "Feedback",
              posts: [],
              title: "New submission in your workspace",
              unsubscribe: {
                kind: "settings",
                url: "https://app.feeblo.com/settings/notifications",
              },
            },
          });
          if (delivery._tag !== "Inserted") {
            return yield* Effect.die("Expected a queued delivery");
          }
          // One recovery attempt short of the ten-failure budget, so this run
          // reaches the terminal `markDeliveryOutcome` write instead of
          // deferring the delivery again.
          yield* db
            .update(schema.emailDeliveryTable)
            .set({
              state: "sending",
              lastError: {
                consecutiveInfrastructureFailures: 9,
                tag: "EmailDeliveryActivityError",
              },
            })
            .where(eq(schema.emailDeliveryTable.id, delivery.delivery.id));

          const persistenceError = new EffectDrizzleQueryError({
            query: "update email_delivery set state = 'failed'",
            params: [],
            cause: { code: "08006" },
          });
          const error = yield* Effect.flip(
            deliverEmailDelivery({ deliveryId: delivery.delivery.id }).pipe(
              Effect.provideService(
                EmailOutboxRepository,
                EmailOutboxRepository.of({
                  ...repository,
                  markDeliveryOutcome: () => Effect.fail(persistenceError),
                })
              )
            )
          );

          expect(error).toBe(persistenceError);
          // A swallowed write would report success while the row is still
          // stuck mid-retry; the queue element must instead fail so `take`
          // re-offers it and the terminal write is attempted again.
          expect(
            (yield* repository.findDeliveryById(delivery.delivery.id))?.state
          ).toBe("sending");
        })
    );

    it.effect(
      "fails the dispatcher element when the exhausted-intent write cannot be persisted",
      () =>
        Effect.gen(function* () {
          const { intentId } = yield* fixture;
          const repository = yield* EmailOutboxRepository;
          const persistenceError = new EffectDrizzleQueryError({
            query: "update email_outbox set state = 'failed'",
            params: [],
            cause: { code: "08006" },
          });
          // Materialization fails every attempt, so the dispatcher spends its
          // whole budget and reaches the terminal write; that write is what
          // fails here.
          const failingRepository = EmailOutboxRepository.of({
            ...repository,
            createDelivery: () => Effect.fail(persistenceError),
            markIntentState: (input) =>
              input.state === "failed"
                ? Effect.fail(persistenceError)
                : repository.markIntentState(input),
          });

          const fiber = yield* dispatchEmailOutboxIntent({
            outboxId: intentId,
          }).pipe(
            Effect.provideService(EmailOutboxRepository, failingRepository),
            Effect.forkScoped
          );
          // Let the whole dispatcher retry budget elapse.
          yield* TestClock.adjust("1 hour");
          const error = yield* Effect.flip(Fiber.join(fiber));

          expect(error).toBe(persistenceError);
        })
    );

    it.effect(
      "does not send again when a terminal delivery workflow is replayed",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer({ outcomes: [{ _tag: "permanentFailure" }] });
          const { intentId } = yield* fixture;
          yield* dispatchEmailOutboxIntent({ outboxId: intentId });
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
          yield* deliverEmailDelivery({ deliveryId: delivery.id });
          expect((yield* testMailerState).attempts).toBe(attemptsBeforeReplay);
        })
    );

    const insertPrivateBoardPost = (organizationId: string) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const now = yield* DateTime.nowAsDate;
        const boardId = `brd_private_${organizationId}`;
        const statusId = `pst_private_${organizationId}`;
        const postId = `post_private_${organizationId}`;
        yield* db.insert(schema.boardTable).values({
          id: boardId,
          organizationId,
          name: "Private feedback",
          slug: boardId,
          visibility: "PRIVATE",
          createdAt: now,
          updatedAt: now,
        });
        yield* db.insert(schema.postStatusTable).values({
          id: statusId,
          organizationId,
          type: "IN_PROGRESS",
          orderIndex: 9,
        });
        yield* db.insert(schema.postTable).values({
          id: postId,
          organizationId,
          boardId,
          statusId,
          title: "Private post",
          slug: boardId,
          content: "x",
          excerpt: "x",
          createdAt: now,
          updatedAt: now,
        });
        return { postId };
      });

    const recordStatusChangeIntent = (organizationId: string, postId: string) =>
      Effect.gen(function* () {
        const intent =
          yield* (yield* EmailOutboxRepository).upsertPendingStatusChange({
            aggregateId: postId,
            aggregateType: "post",
            deduplicationKey: `post.status_changed:${organizationId}:${postId}:gate`,
            expiresAt: null,
            organizationId,
            payload: {
              kind: "post.status_changed",
              postId,
              statusId: `pst_${organizationId}`,
            },
            scheduledAt: yield* DateTime.nowAsDate,
          });
        if (intent._tag !== "Written") {
          return yield* Effect.die("Expected post intent");
        }
        return intent.intent.id;
      });

    it.effect(
      "skips a shadow-attributed subscriber without organization access",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { organizationId } = yield* fixture;
          yield* enableSubscriberEmails(organizationId);
          const db = yield* Database.Database;
          const postId = `post_${organizationId}`;
          const shadowUserId = yield* UserId.generate;
          yield* db.insert(schema.userTable).values({
            id: shadowUserId,
            email: `behalf-${organizationId}@feeblo.com`,
            name: "Shadowed customer",
            emailVerified: false,
            restrictedToOrganizationId: organizationId,
          });
          yield* addSubscriptionContact({
            email: `shadowed-${organizationId}@example.test`,
            organizationId,
            state: "active",
            topicId: postId,
            topicType: "post",
            userId: shadowUserId,
          });
          const intentId = yield* recordStatusChangeIntent(
            organizationId,
            postId
          );

          const deliveryIds = yield* materializeEmailIntent(intentId);
          expect(deliveryIds).toHaveLength(1);
          yield* Effect.forEach(deliveryIds, (deliveryId) =>
            deliverEmailDelivery({ deliveryId })
          );
          // Terminal: replaying the workflow must not retry the send.
          yield* Effect.forEach(deliveryIds, (deliveryId) =>
            deliverEmailDelivery({ deliveryId })
          );

          const [delivery] = yield* db
            .select()
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.outboxId, intentId));
          expect(delivery?.state).toBe("no_organization_access");
          expect((yield* testMailerState).sentMessages).toHaveLength(0);
        })
    );

    it.effect(
      "delivers to a verified global user on a public board but not on a private board",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { organizationId } = yield* fixture;
          yield* enableSubscriberEmails(organizationId);
          const db = yield* Database.Database;
          const globalUserId = yield* UserId.generate;
          const globalEmail = `global-${organizationId}@example.test`;
          yield* db.insert(schema.userTable).values({
            id: globalUserId,
            email: globalEmail,
            name: "Global user",
            emailVerified: true,
          });

          const publicPostId = `post_${organizationId}`;
          yield* addSubscriptionContact({
            email: globalEmail,
            organizationId,
            state: "active",
            topicId: publicPostId,
            topicType: "post",
            userId: globalUserId,
          });
          const publicIntentId = yield* recordStatusChangeIntent(
            organizationId,
            publicPostId
          );
          const publicDeliveryIds =
            yield* materializeEmailIntent(publicIntentId);
          yield* Effect.forEach(publicDeliveryIds, (deliveryId) =>
            deliverEmailDelivery({ deliveryId })
          );
          const [publicDelivery] = yield* db
            .select()
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.outboxId, publicIntentId));
          expect(publicDelivery?.state).toBe("accepted");

          const { postId: privatePostId } =
            yield* insertPrivateBoardPost(organizationId);
          yield* addSubscriptionContact({
            email: globalEmail,
            organizationId,
            state: "active",
            topicId: privatePostId,
            topicType: "post",
            userId: globalUserId,
          });
          const privateIntentId = yield* recordStatusChangeIntent(
            organizationId,
            privatePostId
          );
          const privateDeliveryIds =
            yield* materializeEmailIntent(privateIntentId);
          yield* Effect.forEach(privateDeliveryIds, (deliveryId) =>
            deliverEmailDelivery({ deliveryId })
          );
          const [privateDelivery] = yield* db
            .select()
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.outboxId, privateIntentId));
          expect(privateDelivery?.state).toBe("no_organization_access");
        })
    );

    it.effect(
      "skips a submission window that includes a post on a private board",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { intentId, organizationId } = yield* fixture;
          const db = yield* Database.Database;
          const globalUserId = yield* UserId.generate;
          const globalEmail = `window-global-${organizationId}@example.test`;
          yield* db.insert(schema.userTable).values({
            id: globalUserId,
            email: globalEmail,
            name: "Global user",
            emailVerified: true,
          });
          // The free plan notifies one opted-in address; this one resolves to a
          // global account with no membership, so only rule 3 can admit it.
          yield* addSubscriptionContact({
            email: globalEmail,
            organizationId,
            state: "active",
            topicId: null,
            topicType: "submission",
            userId: globalUserId,
          });
          const { postId: privatePostId } =
            yield* insertPrivateBoardPost(organizationId);
          yield* (yield* EmailOutboxRepository).upsertPendingSubmissionWindow({
            now: yield* DateTime.nowAsDate,
            organizationId,
            postId: privatePostId,
          });
          yield* TestClock.adjust("5 minutes");

          const deliveryIds = yield* materializeEmailIntent(intentId);
          expect(deliveryIds).toHaveLength(1);
          yield* Effect.forEach(deliveryIds, (deliveryId) =>
            deliverEmailDelivery({ deliveryId })
          );
          const [delivery] = yield* db
            .select()
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.outboxId, intentId));
          // The window's email carries the private post's title too, so one
          // public board must not admit a recipient who cannot see the rest.
          expect(delivery?.state).toBe("no_organization_access");
          expect((yield* testMailerState).sentMessages).toHaveLength(0);
        })
    );

    it.effect(
      "does not admit a global recipient after a private post in the window is deleted",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { intentId, organizationId } = yield* fixture;
          const db = yield* Database.Database;
          const globalUserId = yield* UserId.generate;
          const globalEmail = `deleted-private-${organizationId}@example.test`;
          yield* db.insert(schema.userTable).values({
            id: globalUserId,
            email: globalEmail,
            name: "Global user",
            emailVerified: true,
          });
          yield* addSubscriptionContact({
            email: globalEmail,
            organizationId,
            state: "active",
            topicId: null,
            topicType: "submission",
            userId: globalUserId,
          });
          const { postId: privatePostId } =
            yield* insertPrivateBoardPost(organizationId);
          yield* (yield* EmailOutboxRepository).upsertPendingSubmissionWindow({
            now: yield* DateTime.nowAsDate,
            organizationId,
            postId: privatePostId,
          });
          yield* TestClock.adjust("5 minutes");

          // The email is rendered now, while the private post still exists, so
          // its title is in the stored payload.
          const deliveryIds = yield* materializeEmailIntent(intentId);
          expect(deliveryIds).toHaveLength(1);
          const [rendered] = yield* db
            .select({
              templatePayload: schema.emailDeliveryTable.templatePayload,
            })
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.outboxId, intentId));
          expect(rendered?.templatePayload).toMatchObject({
            posts: [{ label: "Ship email outbox" }, { label: "Private post" }],
          });

          // The post is gone by the time the delivery is attempted, so a check
          // that only reads current rows cannot see the private board any more
          // even though the rendered email still names it.
          yield* db
            .delete(schema.postTable)
            .where(eq(schema.postTable.id, privatePostId));
          yield* Effect.forEach(deliveryIds, (deliveryId) =>
            deliverEmailDelivery({ deliveryId })
          );

          const [delivery] = yield* db
            .select()
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.outboxId, intentId));
          expect(delivery?.state).toBe("no_organization_access");
          expect((yield* testMailerState).sentMessages).toHaveLength(0);
        })
    );

    it.effect(
      "does not admit a global recipient after the window's only post is deleted",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { intentId, organizationId, postId } = yield* fixture;
          const db = yield* Database.Database;
          const globalUserId = yield* UserId.generate;
          const globalEmail = `gone-public-${organizationId}@example.test`;
          yield* db.insert(schema.userTable).values({
            id: globalUserId,
            email: globalEmail,
            name: "Global user",
            emailVerified: true,
          });
          yield* addSubscriptionContact({
            email: globalEmail,
            organizationId,
            state: "active",
            topicId: null,
            topicType: "submission",
            userId: globalUserId,
          });
          yield* TestClock.adjust("5 minutes");

          // Rendered while the post was public, so the stored payload proves
          // the mail named a public post and nothing more.
          const deliveryIds = yield* materializeEmailIntent(intentId);
          expect(deliveryIds).toHaveLength(1);
          const [rendered] = yield* db
            .select({
              templatePayload: schema.emailDeliveryTable.templatePayload,
            })
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.outboxId, intentId));
          expect(rendered?.templatePayload).toMatchObject({
            notifiedBoardVisibility: "PUBLIC",
            posts: [{ label: "Ship email outbox" }],
          });

          // The post is gone by the time the delivery is attempted, so no row
          // is left to prove the mail's content is still public.
          yield* db
            .delete(schema.postTable)
            .where(eq(schema.postTable.id, postId));
          yield* Effect.forEach(deliveryIds, (deliveryId) =>
            deliverEmailDelivery({ deliveryId })
          );

          const [delivery] = yield* db
            .select()
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.outboxId, intentId));
          expect(delivery?.state).toBe("no_organization_access");
          expect((yield* testMailerState).sentMessages).toHaveLength(0);
        })
    );

    it.effect(
      "delivers a submission window whose posts are all on public boards",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const {
            boardId,
            intentId,
            organizationId,
            ownerMemberId,
            statusId,
            userId,
          } = yield* fixture;
          const db = yield* Database.Database;
          const globalUserId = yield* UserId.generate;
          const globalEmail = `public-window-${organizationId}@example.test`;
          yield* db.insert(schema.userTable).values({
            id: globalUserId,
            email: globalEmail,
            name: "Global user",
            emailVerified: true,
          });
          yield* addSubscriptionContact({
            email: globalEmail,
            organizationId,
            state: "active",
            topicId: null,
            topicType: "submission",
            userId: globalUserId,
          });
          const secondPostId = yield* PostId.generate;
          yield* addSubmissionPost({
            boardId,
            organizationId,
            ownerMemberId,
            postId: secondPostId,
            slug: "second-public-submission",
            statusId,
            title: "Second public submission",
            userId,
          });
          yield* (yield* EmailOutboxRepository).upsertPendingSubmissionWindow({
            now: yield* DateTime.nowAsDate,
            organizationId,
            postId: secondPostId,
          });
          yield* TestClock.adjust("5 minutes");

          const deliveryIds = yield* materializeEmailIntent(intentId);
          expect(deliveryIds).toHaveLength(1);
          yield* Effect.forEach(deliveryIds, (deliveryId) =>
            deliverEmailDelivery({ deliveryId })
          );
          const [delivery] = yield* db
            .select()
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.outboxId, intentId));
          expect(delivery?.state).toBe("accepted");
          expect((yield* testMailerState).sentMessages).toHaveLength(1);
        })
    );

    it.effect(
      "keeps members and SSO-bound users eligible even on private boards",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { organizationId } = yield* fixture;
          yield* enableSubscriberEmails(organizationId);
          const db = yield* Database.Database;
          const { postId } = yield* insertPrivateBoardPost(organizationId);

          const memberUserId = yield* UserId.generate;
          yield* db.insert(schema.userTable).values({
            id: memberUserId,
            email: `member-${organizationId}@example.test`,
            name: "Member user",
            emailVerified: true,
          });
          yield* db.insert(schema.memberTable).values({
            id: `mem_gate_${organizationId}`,
            organizationId,
            userId: memberUserId,
            role: "manager",
            createdAt: yield* DateTime.nowAsDate,
          });
          yield* addSubscriptionContact({
            email: `member-${organizationId}@example.test`,
            organizationId,
            state: "active",
            topicId: postId,
            topicType: "post",
            userId: memberUserId,
          });

          const ssoUserId = yield* UserId.generate;
          yield* db.insert(schema.userTable).values({
            id: ssoUserId,
            email: `sso-${organizationId}@example.test`,
            name: "SSO user",
            emailVerified: true,
            restrictedToOrganizationId: organizationId,
          });
          yield* addSubscriptionContact({
            email: `sso-${organizationId}@example.test`,
            organizationId,
            state: "active",
            topicId: postId,
            topicType: "post",
            userId: ssoUserId,
          });

          const intentId = yield* recordStatusChangeIntent(
            organizationId,
            postId
          );
          const deliveryIds = yield* materializeEmailIntent(intentId);
          yield* Effect.forEach(deliveryIds, (deliveryId) =>
            deliverEmailDelivery({ deliveryId })
          );
          const mailbox = yield* testMailerState;
          expect(
            mailbox.sentMessages.map((message) => message.to).sort()
          ).toEqual([
            `member-${organizationId}@example.test`.toLowerCase(),
            `sso-${organizationId}@example.test`.toLowerCase(),
          ]);
        })
    );

    it.effect(
      "still delivers to verified external subscribers without any account",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const { organizationId } = yield* fixture;
          yield* enableSubscriberEmails(organizationId);
          const postId = `post_${organizationId}`;
          yield* addSubscriptionContact({
            email: `external-${organizationId}@example.test`,
            organizationId,
            state: "active",
            topicId: postId,
            topicType: "post",
          });
          const intentId = yield* recordStatusChangeIntent(
            organizationId,
            postId
          );
          const deliveryIds = yield* materializeEmailIntent(intentId);
          yield* Effect.forEach(deliveryIds, (deliveryId) =>
            deliverEmailDelivery({ deliveryId })
          );
          const mailbox = yield* testMailerState;
          expect(mailbox.sentMessages.map((message) => message.to)).toEqual([
            `external-${organizationId}@example.test`.toLowerCase(),
          ]);
        })
    );

    it.effect("points merged notifications at the surviving target", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const { organizationId } = yield* fixture;
        const now = fixtureNow;
        const sourcePostId = yield* PostId.generate;
        const targetPostId = yield* PostId.generate;
        yield* db.insert(schema.postTable).values([
          {
            id: sourcePostId,
            organizationId,
            boardId: `brd_${organizationId}`,
            statusId: `pst_${organizationId}`,
            title: "Duplicate feedback",
            slug: "duplicate-feedback",
            content: "x",
            excerpt: "x",
            mergedIntoPostId: targetPostId,
            mergedAt: now,
            archivedAt: now,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: targetPostId,
            organizationId,
            boardId: `brd_${organizationId}`,
            statusId: `pst_${organizationId}`,
            title: "Canonical feedback",
            slug: "canonical-feedback",
            content: "x",
            excerpt: "x",
            createdAt: now,
            updatedAt: now,
          },
        ]);

        expect(
          emailSubscriptionTopicForIntent({
            kind: "post.merged",
            postId: sourcePostId,
            targetPostId,
          })
        ).toEqual({ topicId: targetPostId, topicType: "post" });

        const content = yield* resolveSubscriptionNotificationContent(
          "https://app.feeblo.example",
          {
            organizationId,
            payload: {
              kind: "post.merged",
              postId: sourcePostId,
              targetPostId,
            },
          }
        );

        expect(content?.topic).toEqual({
          topicId: targetPostId,
          topicType: "post",
        });
        expect(content?.templatePayload.actionUrl).toContain(
          "/canonical-feedback"
        );
        expect(content?.templatePayload.body).toContain("Duplicate feedback");
      })
    );

    it.effect("points unmerged notifications back at the restored source", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const { organizationId } = yield* fixture;
        const now = fixtureNow;
        const sourcePostId = yield* PostId.generate;
        const targetPostId = yield* PostId.generate;
        yield* db.insert(schema.postTable).values([
          {
            id: sourcePostId,
            organizationId,
            boardId: `brd_${organizationId}`,
            statusId: `pst_${organizationId}`,
            title: "Duplicate feedback",
            slug: "duplicate-feedback",
            content: "x",
            excerpt: "x",
            createdAt: now,
            updatedAt: now,
          },
          {
            id: targetPostId,
            organizationId,
            boardId: `brd_${organizationId}`,
            statusId: `pst_${organizationId}`,
            title: "Canonical feedback",
            slug: "canonical-feedback",
            content: "x",
            excerpt: "x",
            createdAt: now,
            updatedAt: now,
          },
        ]);

        expect(
          emailSubscriptionTopicForIntent({
            kind: "post.unmerged",
            postId: sourcePostId,
            targetPostId,
          })
        ).toEqual({ topicId: sourcePostId, topicType: "post" });

        const content = yield* resolveSubscriptionNotificationContent(
          "https://app.feeblo.example",
          {
            organizationId,
            payload: {
              kind: "post.unmerged",
              postId: sourcePostId,
              targetPostId,
            },
          }
        );

        expect(content?.topic).toEqual({
          topicId: sourcePostId,
          topicType: "post",
        });
        expect(content?.templatePayload.actionUrl).toContain(
          "/duplicate-feedback"
        );
        expect(content?.templatePayload.body).toContain("Duplicate feedback");
        expect(content?.templatePayload.body).toContain("Canonical feedback");
      })
    );
  });
});

describe("EmailOutbox queues with plain-HTTP API_URL", () => {
  layer(
    EmailOutboxWorkerLayer.pipe(
      Layer.provideMerge(EmailOutboxQueues.layer),
      Layer.provideMerge(
        EmailOutboxConfig.layerTest(
          new URL("https://test.feeblo.example"),
          new URL("http://insecure.feeblo.example")
        )
      ),
      Layer.provideMerge(MailerTestLayer),
      Layer.provideMerge(EmailOutboxRepository.layer),
      Layer.provideMerge(
        EmailSubscriptionRepository.layerWithoutDependencies.pipe(
          Layer.provide(
            EmailSubscriptionTokenService.layerTest(
              "email-outbox-workflow-test-signing-secret"
            )
          )
        )
      ),
      Layer.provideMerge(
        EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer))
      ),
      Layer.provideMerge(
        PersistedQueue.layer.pipe(
          Layer.provide(PersistedQueue.layerStoreMemory)
        )
      ),
      Layer.provideMerge(Database.PgliteDatabaseLive)
    )
  )("in-memory persisted queue", (it) => {
    it.effect(
      "fails changelog deliveries terminally instead of emailing an HTTP tokenized link",
      () =>
        Effect.gen(function* () {
          yield* resetTestMailer();
          const db = yield* Database.Database;
          const now = fixtureNow;
          yield* TestClock.setTime(now.getTime());
          const organizationId = yield* WorkspaceId.generate;
          yield* db.insert(schema.organizationTable).values({
            id: organizationId,
            name: "Outbox",
            slug: organizationId,
            createdAt: now,
          });
          yield* db.insert(schema.siteTable).values({
            id: `site_${organizationId}`,
            name: "Outbox site",
            subdomain: `outbox-${organizationId}`,
            customDomain: null,
            changelogVisibility: "PUBLIC",
            roadmapVisibility: "PUBLIC",
            hidePoweredBy: false,
            organizationId,
            createdAt: now,
            updatedAt: now,
          });
          yield* enableSubscriberEmails(organizationId);
          const changelogId = `changelog_${organizationId}`;
          const subscriptions = yield* EmailSubscriptionRepository;
          const consentNow = fixtureNow;
          const subscriber = yield* subscriptions.requestSubscription({
            email: `changelog-${organizationId}@example.test`,
            now: consentNow,
            organizationId,
            source: "explicit",
            topic: { topicId: null, topicType: "changelog" },
            verificationExpiresAt: shiftDate(consentNow, Duration.days(1)),
          });
          if (Option.isNone(subscriber.verificationToken)) {
            return yield* Effect.die("Expected a verification token");
          }
          yield* subscriptions.verifySubscription({
            now: consentNow,
            verificationToken: Redacted.value(
              subscriber.verificationToken.value
            ),
          });
          yield* db.insert(schema.changelogTable).values({
            id: changelogId,
            organizationId,
            title: "New release",
            slug: "new-release",
            content: "Release notes",
            excerpt: "Release notes",
            status: "published",
            publishedAt: now,
            creatorId: null,
            creatorMemberId: null,
            createdAt: now,
            updatedAt: now,
          });
          const intent = yield* (yield* EmailOutboxRepository).recordIntent({
            aggregateId: changelogId,
            aggregateType: "changelog",
            deduplicationKey: `changelog.published:${organizationId}:${changelogId}`,
            expiresAt: null,
            kind: "changelog.published",
            organizationId,
            payload: { kind: "changelog.published", changelogId },
            scheduledAt: now,
          });
          if (intent._tag !== "Inserted") {
            return yield* Effect.die("Expected changelog intent");
          }
          const deliveryIds = yield* materializeEmailIntent(intent.intent.id);
          yield* Effect.forEach(deliveryIds, (deliveryId) =>
            deliverEmailDelivery({ deliveryId })
          );
          yield* waitForDelivery(
            intent.intent.id,
            (delivery) => delivery.state === "failed"
          );
          const [delivery] = yield* db
            .select()
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.outboxId, intent.intent.id));
          expect(delivery?.lastError).toMatchObject({
            tag: "MailTemplateRenderError",
          });
          expect((yield* testMailerState).sentMessages).toHaveLength(0);
        })
    );
  });
});

describe("EmailOutbox queues with delivery paused", () => {
  // The batch test needs one hundred recipients to hit the materialization
  // batch size, and the shared worker layer must not spend the suite's mailer
  // budget on them. Pausing delivery keeps the workers off the renderer; the
  // test only needs the dispatcher, and no later test can see the deferred
  // rows because this suite runs last.
  layer(makeTestLayer({ globalDeliveryPaused: true }))(
    "in-memory persisted queue",
    (it) => {
      it.effect(
        "re-offers a partially materialized intent after a plan resume",
        () =>
          Effect.gen(function* () {
            yield* resetTestMailer();
            const { organizationId } = yield* fixture;
            const db = yield* Database.Database;
            const changelogId = `resume_batch_${organizationId}`;
            const now = yield* DateTime.nowAsDate;
            yield* db.insert(schema.changelogTable).values({
              id: changelogId,
              organizationId,
              title: "Batched resume",
              slug: "batched-resume",
              content: "x",
              excerpt: "x",
              status: "published",
              publishedAt: now,
              creatorId: null,
              creatorMemberId: null,
              createdAt: now,
              updatedAt: now,
            });
            // Exactly one materialization batch, so the resumed intent stays
            // pending after the first batch and needs a second dispatch.
            yield* addChangelogSubscribers(organizationId, 100);
            const intent = yield* (yield* EmailOutboxRepository).recordIntent({
              aggregateId: changelogId,
              aggregateType: "changelog",
              deduplicationKey: `changelog.resume-batch:${organizationId}:${changelogId}`,
              expiresAt: shiftDate(fixtureNow, Duration.days(1)),
              kind: "changelog.published",
              organizationId,
              payload: { kind: "changelog.published", changelogId },
              scheduledAt: fixtureNow,
            });
            if (intent._tag !== "Inserted") {
              return yield* Effect.die("Expected resumable batch intent");
            }

            // The first dispatch parks the intent on the plan and consumes its
            // element id.
            yield* reconcileEmailOutbox();
            yield* waitForIntentState(intent.intent.id, "paused_by_plan");

            // Upgrade: the resume materializes one batch and leaves the intent
            // pending under a new `updatedAt`. The next sweep has to offer that
            // revision rather than hit the consumed element id.
            yield* TestClock.adjust("1 minute");
            yield* enableSubscriberEmails(organizationId);
            yield* reconcileEmailOutbox();
            yield* TestClock.adjust("1 minute");
            yield* reconcileEmailOutbox();
            yield* waitForIntentState(intent.intent.id, "materialized");

            const deliveries = yield* db
              .select({ id: schema.emailDeliveryTable.id })
              .from(schema.emailDeliveryTable)
              .where(eq(schema.emailDeliveryTable.outboxId, intent.intent.id));
            expect(deliveries).toHaveLength(100);
          })
      );
    }
  );
});

/**
 * Two fresh workspaces, each with one materialized delivery, and the first
 * delivery marked as having spent one attempt this month.
 *
 * Both volume-limit suites trip their guard by spending that one attempt; only
 * the layer config and the assertions differ.
 */
const spendOneAttemptInTwoWorkspaces = Effect.gen(function* () {
  yield* resetTestMailer();
  const first = yield* fixture;
  const second = yield* fixture;
  const db = yield* Database.Database;
  const firstDeliveryId = (yield* materializeEmailIntent(first.intentId))[0];
  const secondDeliveryId = (yield* materializeEmailIntent(second.intentId))[0];
  if (firstDeliveryId === undefined || secondDeliveryId === undefined) {
    return yield* Effect.die("Expected one delivery per workspace");
  }

  yield* db
    .update(schema.emailDeliveryTable)
    .set({ attemptCount: 1 })
    .where(eq(schema.emailDeliveryTable.id, firstDeliveryId));

  yield* deliverEmailDelivery({ deliveryId: firstDeliveryId });
  yield* deliverEmailDelivery({ deliveryId: secondDeliveryId });

  return { db, firstDeliveryId, secondDeliveryId };
});

describe("EmailOutbox workspace volume limit", () => {
  // A workspace may spend its own monthly allowance without spending the
  // platform-wide one every other workspace shares.
  layer(makeTestLayer({ workspaceMonthlySendLimit: 1 }))(
    "in-memory persisted queue",
    (it) => {
      it.effect(
        "defers one workspace's delivery without touching another's",
        () =>
          Effect.gen(function* () {
            const { db, firstDeliveryId, secondDeliveryId } =
              yield* spendOneAttemptInTwoWorkspaces;

            const [throttled] = yield* db
              .select()
              .from(schema.emailDeliveryTable)
              .where(eq(schema.emailDeliveryTable.id, firstDeliveryId));
            expect(throttled?.state).toBe("deferred");
            expect(throttled?.lastError).toMatchObject({
              reason: "workspace_monthly_volume_limit",
            });

            const [unaffected] = yield* db
              .select()
              .from(schema.emailDeliveryTable)
              .where(eq(schema.emailDeliveryTable.id, secondDeliveryId));
            expect(unaffected?.state).toBe("accepted");
            expect((yield* testMailerState).sentMessages).toHaveLength(1);
          })
      );
    }
  );
});

describe("EmailOutbox platform volume limit", () => {
  // The per-workspace breaker must not replace the platform-wide backstop: a
  // workspace under its own allowance still stops once the shared one is spent.
  layer(makeTestLayer({ monthlySendLimit: 1 }))(
    "in-memory persisted queue",
    (it) => {
      it.effect(
        "still defers every workspace once the shared allowance is spent",
        () =>
          Effect.gen(function* () {
            const { db, firstDeliveryId, secondDeliveryId } =
              yield* spendOneAttemptInTwoWorkspaces;

            const [firstStored] = yield* db
              .select()
              .from(schema.emailDeliveryTable)
              .where(eq(schema.emailDeliveryTable.id, firstDeliveryId));
            const [secondStored] = yield* db
              .select()
              .from(schema.emailDeliveryTable)
              .where(eq(schema.emailDeliveryTable.id, secondDeliveryId));
            expect(firstStored?.state).toBe("deferred");
            expect(secondStored?.state).toBe("deferred");
            expect(secondStored?.lastError).toMatchObject({
              reason: "monthly_volume_limit",
            });
            expect((yield* testMailerState).sentMessages).toHaveLength(0);
          })
      );
    }
  );
});
