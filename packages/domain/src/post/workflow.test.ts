import { assert, describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { MailDeliveryError, Mailer } from "@feeblo/transactional/mailer";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";
import * as Workflow from "effect/unstable/workflow/Workflow";
import * as WorkflowEngine from "effect/unstable/workflow/WorkflowEngine";
import {
  SubmissionEmailNotificationWorkflow,
  SubmissionEmailNotificationWorkflowLayer,
  scheduleSubmissionNotificationBatch,
} from "./workflow";

type MailMessage = Parameters<Mailer["Service"]["send"]>[0];

interface MailerProbeState {
  readonly attempts: number;
  readonly failDelivery: boolean;
  readonly sentMessages: readonly MailMessage[];
}

const initialMailerProbeState: MailerProbeState = {
  attempts: 0,
  failDelivery: false,
  sentMessages: [],
};

class MailerProbe extends Context.Service<MailerProbe>()("MailerProbe", {
  make: Ref.make(initialMailerProbeState),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

const MailerTest = Layer.effect(
  Mailer,
  Effect.gen(function* () {
    const probe = yield* MailerProbe;

    return Mailer.of({
      send: (message) =>
        Ref.modify(probe, (state) => [
          state.failDelivery,
          {
            ...state,
            attempts: state.attempts + 1,
            sentMessages: state.failDelivery
              ? state.sentMessages
              : [...state.sentMessages, message],
          },
        ]).pipe(
          Effect.flatMap((failDelivery) =>
            failDelivery
              ? Effect.fail(
                  new MailDeliveryError({
                    subject: message.subject,
                    cause: new Error("SMTP unavailable"),
                  })
                )
              : Effect.void
          )
        ),
    });
  })
);

const MailerTestLayer = MailerTest.pipe(Layer.provideMerge(MailerProbe.layer));

const TestLayer = SubmissionEmailNotificationWorkflowLayer.pipe(
  Layer.provideMerge(MailerTestLayer),
  Layer.provideMerge(WorkflowEngine.layerMemory),
  Layer.provideMerge(Database.PgliteDatabaseLive)
);

const resetMailer = (failDelivery = false) =>
  Effect.gen(function* () {
    const probe = yield* MailerProbe;
    yield* Ref.set(probe, { ...initialMailerProbeState, failDelivery });
  });

const mailerState = Effect.gen(function* () {
  const probe = yield* MailerProbe;
  return yield* Ref.get(probe);
});

const makeFixture = (titles: readonly string[]) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const suffix = crypto.randomUUID();
    const organizationId = `organization_${suffix}`;
    const userId = `user_${suffix}`;
    const memberId = `member_${suffix}`;
    const boardId = `board_${suffix}`;
    const statusId = `status_${suffix}`;
    const recipientEmail = `owner-${suffix}@acme.test`;
    const now = new Date();

    yield* db.insert(schema.organizationTable).values({
      id: organizationId,
      name: "Acme",
      slug: `acme-${suffix}`,
      createdAt: now,
    });
    yield* db.insert(schema.userTable).values({
      id: userId,
      email: recipientEmail,
      name: "Owner",
    });
    yield* db.insert(schema.memberTable).values({
      id: memberId,
      organizationId,
      userId,
      role: "owner",
      createdAt: now,
    });
    yield* db.insert(schema.boardTable).values({
      id: boardId,
      name: "Feedback",
      slug: "feedback",
      visibility: "PUBLIC",
      organizationId,
      creatorId: userId,
      creatorMemberId: memberId,
      createdAt: now,
      updatedAt: now,
    });
    yield* db.insert(schema.postStatusTable).values({
      id: statusId,
      type: "PENDING",
      orderIndex: 0,
      organizationId,
    });

    const posts = titles.map((title, index) => ({
      id: `post_${index}_${suffix}`,
      title,
      slug: `post-${index}`,
      content: title,
      excerpt: title,
      boardId,
      statusId,
      organizationId,
      creatorId: userId,
      creatorMemberId: memberId,
      createdAt: now,
      updatedAt: now,
    }));

    if (posts.length > 0) {
      yield* db.insert(schema.postTable).values(posts);
      yield* db
        .insert(schema.submissionNotificationQueueTable)
        .values(posts.map(({ id }) => ({ postId: id, organizationId })));
    }

    return { organizationId, posts, recipientEmail };
  });

const activeBatch = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;
    return yield* db.query.submissionNotificationBatchTable.findFirst({
      where: { organizationId },
    });
  });

const queuedPostIds = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;
    const rows = yield* db.query.submissionNotificationQueueTable.findMany({
      where: { organizationId },
    });
    return rows.map(({ postId }) => postId);
  });

const runCooldown = (organizationId: string) =>
  Effect.gen(function* () {
    yield* scheduleSubmissionNotificationBatch(organizationId);
    const batch = yield* activeBatch(organizationId);

    expect(batch).toBeDefined();
    if (!batch) {
      return yield* Effect.die("Expected an active notification batch");
    }

    const payload = { batchId: batch.id, organizationId };
    const executionId = yield* SubmissionEmailNotificationWorkflow.executionId({
      ...payload,
    });

    yield* Effect.yieldNow;
    yield* TestClock.adjust("15 minutes");

    const exit = yield* Effect.exit(
      SubmissionEmailNotificationWorkflow.execute(payload)
    );
    const result = yield* SubmissionEmailNotificationWorkflow.poll(executionId);

    expect(result).toEqual(Option.some(new Workflow.Complete({ exit })));

    return exit;
  });

describe("SubmissionEmailNotificationWorkflow", () => {
  layer(TestLayer)("in-memory workflow engine", (it) => {
    it.effect(
      "delivers all queued posts as one notification after the cooldown",
      () =>
        Effect.gen(function* () {
          yield* resetMailer();
          const fixture = yield* makeFixture([
            "Keyboard shortcuts",
            "Custom export fields",
          ]);

          yield* scheduleSubmissionNotificationBatch(fixture.organizationId);
          const batch = yield* activeBatch(fixture.organizationId);
          assert(batch);
          const payload = {
            batchId: batch.id,
            organizationId: fixture.organizationId,
          };
          const executionId =
            yield* SubmissionEmailNotificationWorkflow.executionId(payload);

          yield* Effect.yieldNow;
          yield* TestClock.adjust("14 minutes");
          yield* Effect.yieldNow;

          expect((yield* mailerState).sentMessages).toHaveLength(0);

          yield* TestClock.adjust("1 minute");
          const exit = yield* Effect.exit(
            SubmissionEmailNotificationWorkflow.execute(payload)
          );
          expect(exit).toEqual(Exit.void);
          expect(
            yield* SubmissionEmailNotificationWorkflow.poll(executionId)
          ).toEqual(Option.some(new Workflow.Complete({ exit: Exit.void })));

          const state = yield* mailerState;
          expect(state.attempts).toBe(1);
          expect(state.sentMessages).toHaveLength(1);
          expect(state.sentMessages[0]).toMatchObject({
            messageId: `<submission.${batch.id}.${encodeURIComponent(fixture.recipientEmail)}@notifications.feeblo>`,
            subject: "New submissions in your workspace",
            to: fixture.recipientEmail,
          });
          expect(yield* queuedPostIds(fixture.organizationId)).toEqual([]);
          expect(yield* activeBatch(fixture.organizationId)).toBeUndefined();
        })
    );

    it.effect("runs a later notification batch for the same organization", () =>
      Effect.gen(function* () {
        yield* resetMailer();
        const fixture = yield* makeFixture(["First submission"]);

        const firstResult = yield* runCooldown(fixture.organizationId);
        expect(firstResult).toEqual(Exit.void);

        const db = yield* currentDb;
        const firstPost = fixture.posts[0];
        if (!firstPost) {
          return yield* Effect.die("Expected the fixture to contain a post");
        }
        const secondPost = {
          ...firstPost,
          id: `second_${crypto.randomUUID()}`,
          title: "Second submission",
          slug: "second-submission",
        };
        yield* db.insert(schema.postTable).values(secondPost);
        yield* db.insert(schema.submissionNotificationQueueTable).values({
          postId: secondPost.id,
          organizationId: fixture.organizationId,
        });

        const secondResult = yield* runCooldown(fixture.organizationId);
        expect(secondResult).toEqual(Exit.void);

        const state = yield* mailerState;
        expect(state.sentMessages).toHaveLength(2);
        expect(state.sentMessages.map(({ subject }) => subject)).toEqual([
          "New submission in your workspace",
          "New submission in your workspace",
        ]);
      })
    );

    it.effect(
      "preserves queued posts and releases the batch after delivery fails",
      () =>
        Effect.gen(function* () {
          yield* resetMailer(true);
          const fixture = yield* makeFixture(["Keep this submission"]);

          const result = yield* runCooldown(fixture.organizationId);

          expect(Exit.isFailure(result)).toBe(true);
          const state = yield* mailerState;
          expect(state.attempts).toBe(4);
          expect(state.sentMessages).toEqual([]);
          expect(yield* queuedPostIds(fixture.organizationId)).toEqual([
            fixture.posts[0]?.id,
          ]);
          expect(yield* activeBatch(fixture.organizationId)).toBeUndefined();
        })
    );

    it.effect("does not schedule a batch when the queue is empty", () =>
      Effect.gen(function* () {
        yield* resetMailer();
        const fixture = yield* makeFixture([]);

        yield* scheduleSubmissionNotificationBatch(fixture.organizationId);

        expect(yield* activeBatch(fixture.organizationId)).toBeUndefined();
        expect(yield* mailerState).toEqual(initialMailerProbeState);
      })
    );

    it.effect("deduplicates scheduler calls during the cooldown", () =>
      Effect.gen(function* () {
        yield* resetMailer();
        const fixture = yield* makeFixture(["Only once"]);

        yield* scheduleSubmissionNotificationBatch(fixture.organizationId);
        const firstBatch = yield* activeBatch(fixture.organizationId);
        assert(firstBatch);
        yield* scheduleSubmissionNotificationBatch(fixture.organizationId);
        const secondBatch = yield* activeBatch(fixture.organizationId);

        expect(secondBatch?.id).toBe(firstBatch.id);
        expect(yield* runCooldown(fixture.organizationId)).toEqual(Exit.void);
        expect((yield* mailerState).sentMessages).toHaveLength(1);
      })
    );

    it.effect("includes posts queued during the cooldown", () =>
      Effect.gen(function* () {
        yield* resetMailer();
        const fixture = yield* makeFixture(["Queued first"]);

        yield* scheduleSubmissionNotificationBatch(fixture.organizationId);
        const batch = yield* activeBatch(fixture.organizationId);
        assert(batch);
        const payload = {
          batchId: batch.id,
          organizationId: fixture.organizationId,
        };
        yield* Effect.yieldNow;
        yield* TestClock.adjust("10 minutes");

        const firstPost = fixture.posts[0];
        if (!firstPost) {
          return yield* Effect.die("Expected the fixture to contain a post");
        }
        const latePost = {
          ...firstPost,
          id: `late_${crypto.randomUUID()}`,
          title: "Queued during cooldown",
          slug: "queued-during-cooldown",
        };
        const db = yield* currentDb;
        yield* db.insert(schema.postTable).values(latePost);
        yield* db.insert(schema.submissionNotificationQueueTable).values({
          postId: latePost.id,
          organizationId: fixture.organizationId,
        });

        yield* TestClock.adjust("5 minutes");
        expect(
          yield* Effect.exit(
            SubmissionEmailNotificationWorkflow.execute(payload)
          )
        ).toEqual(Exit.void);

        const state = yield* mailerState;
        expect(state.sentMessages).toHaveLength(1);
        expect(state.sentMessages[0]?.subject).toBe(
          "New submissions in your workspace"
        );
        expect(yield* queuedPostIds(fixture.organizationId)).toEqual([]);
      })
    );
  });
});
