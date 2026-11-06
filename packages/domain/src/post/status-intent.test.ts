import { describe, expect, it, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  POST_STATUS_TYPES,
  type TPostStatusType,
} from "@feeblo/domain-contracts/post-status-type";
import { WorkspaceId } from "@feeblo/id";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { postStatusCoalescingWindow } from "../email-outbox/config";
import { EmailOutboxRepository } from "../email-outbox/repository";
import {
  CLOSING_POST_STATUS_TYPE,
  POST_STATUS_INTENT_KINDS,
  postStatusIntentKindFor,
  recordPostStatusChangeIntent,
} from "./status-intent";

/** The `Date` for a known instant, built through `DateTime`. */
const dateAt = (instant: string | number | Date): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(instant));

const NOW = dateAt("2026-08-09T00:00:00.000Z");
const WINDOW_MS = Duration.toMillis(postStatusCoalescingWindow);

/**
 * The decision is one line of rule, so the test is about the *set*: exactly one
 * status type is a closure, every other type (and an unresolved one) coalesces.
 *
 * Writing it against `POST_STATUS_TYPES` rather than a hand-listed subset is the
 * point — a status type added to the vocabulary is classified by this test
 * before it can be shipped unclassified.
 */
describe("post status intent decision", () => {
  it("makes exactly one status type a closure", () => {
    const closures = POST_STATUS_TYPES.filter(
      (type) => postStatusIntentKindFor(type) === "post.closed"
    );

    expect(closures).toStrictEqual([CLOSING_POST_STATUS_TYPE]);
  });

  it("coalesces every other status move", () => {
    const coalesced = POST_STATUS_TYPES.filter(
      (type) => postStatusIntentKindFor(type) === "post.status_changed"
    );

    expect(coalesced).toStrictEqual(
      POST_STATUS_TYPES.filter((type) => type !== CLOSING_POST_STATUS_TYPE)
    );
  });

  it("treats an unresolved status type as a change, not a closure", () => {
    // The editor path reads the status row before the write, so a type can be
    // absent when the id no longer resolves. A missing type is not evidence of
    // a closure, and the previous code fell through to the change intent.
    expect(postStatusIntentKindFor(undefined)).toBe("post.status_changed");
  });

  it("produces exactly the two intents it names", () => {
    const kinds = new Set(
      POST_STATUS_TYPES.map((type) => postStatusIntentKindFor(type))
    );

    expect([...kinds].sort()).toStrictEqual(
      [...POST_STATUS_INTENT_KINDS].sort()
    );
  });
});

describe("recordPostStatusChangeIntent", () => {
  const TestLayer = EmailOutboxRepository.layer.pipe(
    Layer.provideMerge(Database.PgliteDatabaseLive)
  );

  const createOrganization = (id: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.organizationTable).values({
        id,
        name: "Post status intent test workspace",
        slug: id,
        createdAt: NOW,
      });
    });

  const record = (
    organizationId: string,
    statusType: TPostStatusType | undefined,
    statusId = "pst_status_closed"
  ) =>
    recordPostStatusChangeIntent({
      actorUserId: null,
      now: NOW,
      organizationId,
      postId: "pst_status_intent",
      statusId,
      statusType,
    });

  layer(TestLayer)("recording", (it) => {
    it.effect("records an immediate post.closed intent for a closure", () =>
      Effect.gen(function* () {
        const organizationId = yield* WorkspaceId.generate;
        const repository = yield* EmailOutboxRepository;

        yield* createOrganization(organizationId);
        const outboxId = yield* record(
          organizationId,
          CLOSING_POST_STATUS_TYPE,
          "pst_status_closed"
        );

        expect(outboxId).toBeDefined();
        const pending = yield* repository.findPending({
          before: NOW,
          organizationId,
        });

        expect(pending).toHaveLength(1);
        expect(pending[0]?.kind).toBe("post.closed");
        // A closure is not coalesced: it is due immediately.
        expect(pending[0]?.scheduledAt).toStrictEqual(NOW);
      })
    );

    it.effect("defers a non-closure by the coalescing window", () =>
      Effect.gen(function* () {
        const organizationId = yield* WorkspaceId.generate;
        const repository = yield* EmailOutboxRepository;

        yield* createOrganization(organizationId);
        const outboxId = yield* record(
          organizationId,
          "IN_PROGRESS",
          "pst_status_progress"
        );

        expect(outboxId).toBeDefined();
        // Not due yet: the window has not elapsed.
        expect(
          yield* repository.findPending({ before: NOW, organizationId })
        ).toStrictEqual([]);

        const pending = yield* repository.findPending({
          before: dateAt(NOW.getTime() + WINDOW_MS),
          organizationId,
        });

        expect(pending).toHaveLength(1);
        expect(pending[0]?.kind).toBe("post.status_changed");
        expect(pending[0]?.scheduledAt).toStrictEqual(
          dateAt(NOW.getTime() + WINDOW_MS)
        );
      })
    );

    it.effect("coalesces two non-closures into one window", () =>
      Effect.gen(function* () {
        const organizationId = yield* WorkspaceId.generate;
        const repository = yield* EmailOutboxRepository;

        yield* createOrganization(organizationId);
        yield* record(organizationId, "PLANNED", "pst_status_planned");
        yield* record(organizationId, "IN_PROGRESS", "pst_status_progress");

        const pending = yield* repository.findPending({
          before: dateAt(NOW.getTime() + 60 * 60 * 1000),
          organizationId,
        });

        expect(pending).toHaveLength(1);
        expect(pending[0]?.kind).toBe("post.status_changed");
      })
    );
  });
});
