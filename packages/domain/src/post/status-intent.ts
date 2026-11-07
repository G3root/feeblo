import { attachCause } from "@feeblo/db";
import type { TPostStatusType } from "@feeblo/domain-contracts/post-status-type";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import { postStatusCoalescingWindow } from "../email-outbox/config";
import { EmailOutboxRepository } from "../email-outbox/repository";
import { InternalServerError } from "../rpc-errors";

/**
 * The one place a post's new status type becomes a subscriber-email intent.
 *
 * This is a **decision**, not a lifecycle graph, and it is worth saying why.
 * `post_status.type` is the workspace's own vocabulary — a status is named,
 * coloured and ordered by the customer, and a post may move between any two of
 * them — so there are no states whose edges need declaring. What *is* a rule is
 * the side effect: a move into a `CLOSED` status announces itself immediately as
 * `post.closed`, and every other move joins the post's pending coalescing window
 * as `post.status_changed`, so a burst of moves sends one email.
 *
 * The rule used to be written twice, in `post/write.ts` and in
 * `comments/status-update.ts`, the second with a comment saying it mirrored the
 * first. Both copies also carried their own `5 * 60 * 1000` and their own
 * deduplication-key and expiry arithmetic. The decision, the window and the
 * intent shape now live here, so the two surfaces cannot answer differently.
 *
 * An unknown status type — one that was deleted between the read and the write —
 * is not a closure: it falls through to `post.status_changed`, which is what the
 * editor path already did.
 */

/** The two intents a status move can produce, in the order they are described. */
export const POST_STATUS_INTENT_KINDS = [
  "post.closed",
  "post.status_changed",
] as const;

export type TPostStatusIntentKind = (typeof POST_STATUS_INTENT_KINDS)[number];

/** The status type that makes a move a closure rather than a status change. */
export const CLOSING_POST_STATUS_TYPE: TPostStatusType = "CLOSED";

/**
 * The intent a move into `statusType` records.
 *
 * A closure is immediate and timestamped, so closing a post, reopening it, and
 * closing it again announces each closure instead of matching the first attempt
 * forever. Anything else coalesces.
 */
export const postStatusIntentKindFor = (
  statusType: TPostStatusType | undefined
): TPostStatusIntentKind =>
  statusType === CLOSING_POST_STATUS_TYPE
    ? "post.closed"
    : "post.status_changed";

const intentErrorMessage = (kind: TPostStatusIntentKind): string =>
  kind === "post.closed"
    ? "Could not record post closure email intent."
    : "Could not record post status email intent.";

export type RecordPostStatusIntentInput = {
  /** The acting user, or null when a machine key made the move. */
  readonly actorUserId: string | null;
  readonly now: Date;
  readonly organizationId: string;
  readonly postId: string;
  /** The status the post moved to; also the intent payload's status id. */
  readonly statusId: string;
  /** The status type, or undefined when it could not be resolved. */
  readonly statusType: TPostStatusType | undefined;
};

/**
 * Records the subscriber-email intent for one post status move and returns the
 * outbox id to wake, or undefined when the intent was a no-op (a closure that
 * matched an existing deduplication key, or a coalesced move whose window had
 * already materialized).
 *
 * Both surfaces call this inside their own transaction, so the intent is
 * recorded atomically with the status write it describes.
 */
export const recordPostStatusChangeIntent = (
  input: RecordPostStatusIntentInput
): Effect.Effect<
  string | undefined,
  InternalServerError,
  EmailOutboxRepository
> =>
  Effect.gen(function* () {
    const emailOutbox = yield* EmailOutboxRepository;
    const kind = postStatusIntentKindFor(input.statusType);
    const now = DateTime.fromDateUnsafe(input.now);

    if (kind === "post.closed") {
      const result = yield* emailOutbox.recordIntent({
        aggregateId: input.postId,
        aggregateType: "post",
        // Timestamped, so a re-closure announces itself instead of matching
        // the first attempt forever.
        deduplicationKey: `post.closed:${input.organizationId}:${input.postId}:${input.statusId}:${input.now.getTime()}`,
        expiresAt: DateTime.toDate(DateTime.addDuration(now, Duration.days(7))),
        kind: "post.closed",
        organizationId: input.organizationId,
        payload: {
          actorUserId: input.actorUserId,
          kind: "post.closed",
          postId: input.postId,
        },
        scheduledAt: input.now,
      });
      return result._tag === "Inserted" ? result.intent.id : undefined;
    }

    const scheduledAt = DateTime.addDuration(now, postStatusCoalescingWindow);
    const result = yield* emailOutbox.upsertPendingStatusChange({
      aggregateId: input.postId,
      aggregateType: "post",
      deduplicationKey: `post.status_changed:${input.organizationId}:${input.postId}:${input.now.getTime()}`,
      expiresAt: DateTime.toDate(
        DateTime.addDuration(scheduledAt, Duration.days(7))
      ),
      organizationId: input.organizationId,
      payload: {
        actorUserId: input.actorUserId,
        kind: "post.status_changed",
        postId: input.postId,
        statusId: input.statusId,
      },
      scheduledAt: DateTime.toDate(scheduledAt),
    });
    return result._tag === "Written" ? result.intent.id : undefined;
  }).pipe(
    Effect.mapError((error) =>
      attachCause(
        new InternalServerError({
          message: intentErrorMessage(
            postStatusIntentKindFor(input.statusType)
          ),
        }),
        error
      )
    )
  );
