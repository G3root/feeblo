import { currentDb, schema } from "@feeblo/db";
import { BoardId, PostStatusId } from "@feeblo/id";
import { and, eq } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { EmailOutboxRepository } from "../email-outbox/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import { recordPostIntegrationEvent as recordPostIntegrationEventShared } from "../integration/post-event-recording";
import { PostActivityRepository } from "../post-activity/repository";
import { InternalServerError } from "../rpc-errors";
import { FailedToCreateCommentError } from "./errors";
import type { TCommentCreate } from "./schema";
import type { CommentActor } from "./service";

/** Coalescing window for status-change email intents; mirrors `post/write.ts`. */
const postStatusCoalescingDelayMs = 5 * 60 * 1000;

/**
 * Moves a post to the org-scoped status a comment request names, records the
 * `STATUS_CHANGED` activity, the integration event, and the subscriber email
 * intent — mirroring the post editor path (`post/write.ts`), so the same
 * state change notifies the same people whichever surface made it. The
 * in-app notification stays the comment's own (`notifyComment`): the comment
 * is the announcement, and a second status fan-out would notify the same
 * subscribers twice.
 *
 * It lives beside the shared write service rather than inside it because the
 * Public API never moves a post's status through a comment, and the services
 * this needs — an integration-event recorder, an email outbox, the plan
 * gate, a post repository — would otherwise become requirements of a route
 * that never exercises them. The dashboard hands the effect to
 * `CommentService.create`, which runs it inside the create's own
 * transaction, so the comment, the timeline entry, the status change, and
 * the email intent still commit or roll back together; the handler wakes the
 * dispatcher with the returned outbox id after the transaction commits.
 *
 * Returns the id to store on the comment plus the outbox intent's id, or
 * null statusUpdateId when nothing actually changed: a post already in that
 * status is not labeled a status update and records no email intent.
 */
export const applyCommentStatusUpdate = (
  args: TCommentCreate,
  actor: CommentActor
) => {
  const statusUpdateId = args.statusUpdateId ?? null;
  return Effect.gen(function* () {
    if (statusUpdateId === null || args.parentCommentId !== null) {
      // Replies and plain comments never move the post's status.
      return { outboxId: undefined, statusUpdateId: null };
    }
    const db = yield* currentDb;
    const activityRepository = yield* PostActivityRepository;
    const emailOutbox = yield* EmailOutboxRepository;
    const entitlementPolicy = yield* EntitlementPolicy;

    // Resolve the org-scoped status row (and its type, which the email intent
    // branches on exactly as the editor path does) the request refers to.
    const statusRow = yield* db
      .select({
        id: schema.postStatusTable.id,
        type: schema.postStatusTable.type,
      })
      .from(schema.postStatusTable)
      .where(
        and(
          eq(schema.postStatusTable.organizationId, args.organizationId),
          eq(schema.postStatusTable.id, statusUpdateId)
        )
      )
      .limit(1)
      .pipe(Effect.map(EffectArray.get(0)));
    if (Option.isNone(statusRow)) {
      // Unknown status for this organization: keep the comment but do not
      // pretend it changed anything.
      return { outboxId: undefined, statusUpdateId: null };
    }

    const postRow = yield* db
      .select({
        id: schema.postTable.id,
        boardId: schema.postTable.boardId,
        slug: schema.postTable.slug,
        title: schema.postTable.title,
        statusId: schema.postTable.statusId,
      })
      .from(schema.postTable)
      .where(
        and(
          eq(schema.postTable.id, args.postId),
          eq(schema.postTable.organizationId, args.organizationId)
        )
      )
      .limit(1)
      .pipe(Effect.map(EffectArray.get(0)));

    if (
      Option.isNone(postRow) ||
      postRow.value.statusId === statusRow.value.id
    ) {
      // Post missing, or already in the requested status: nothing to apply.
      return { outboxId: undefined, statusUpdateId: null };
    }

    // Compare-and-update keyed by the previously read status: only the
    // transaction that observes the post still in that status may apply the
    // transition, so concurrent changes cannot persist history with a stale
    // previousStatusId.
    const transitionedPost = yield* db
      .update(schema.postTable)
      .set({ statusId: statusRow.value.id })
      .where(
        and(
          eq(schema.postTable.id, args.postId),
          eq(schema.postTable.statusId, postRow.value.statusId)
        )
      )
      .returning({ id: schema.postTable.id })
      .pipe(Effect.map(EffectArray.get(0)));
    if (Option.isNone(transitionedPost)) {
      // A concurrent transition won the race: keep the comment but do not
      // label it a status update or record stale history.
      return { outboxId: undefined, statusUpdateId: null };
    }

    yield* activityRepository.create({
      organizationId: args.organizationId,
      postId: args.postId,
      actorId: actor.userId,
      actorMemberId: actor.memberId,
      kind: "STATUS_CHANGED",
      previousStatusId: postRow.value.statusId,
      nextStatusId: statusRow.value.id,
    });

    yield* recordPostIntegrationEventShared({
      actor:
        actor.memberId === null
          ? { kind: "end_user" }
          : { kind: "member", memberId: actor.memberId },
      boardId: yield* BoardId.parse(postRow.value.boardId),
      eventType: "post.status_changed",
      organizationId: args.organizationId,
      postId: args.postId,
      postSlug: postRow.value.slug,
      previousStatusId: yield* PostStatusId.parse(postRow.value.statusId),
      statusId: yield* PostStatusId.parse(statusRow.value.id),
      title: postRow.value.title,
    }).pipe(
      Effect.mapError(
        () =>
          new FailedToCreateCommentError({
            message: "Failed to apply status update to post",
          })
      )
    );

    // The subscriber email intent, on the same rules the editor's status
    // write applies: the plan gates it, a closure records its own intent,
    // and any other move joins the post's pending coalescing window.
    const outboxId = yield* Effect.gen(function* () {
      const maySend = yield* entitlementPolicy.mayMaterializeEmailIntent({
        organizationId: args.organizationId,
        kind: "post.status_changed",
      });
      if (!maySend) {
        return undefined;
      }
      const now = yield* DateTime.nowAsDate;
      if (statusRow.value.type === "CLOSED") {
        const result = yield* emailOutbox
          .recordIntent({
            aggregateId: args.postId,
            aggregateType: "post",
            // Timestamped like the editor path, so a re-closure announces
            // itself instead of matching the first attempt forever.
            deduplicationKey: `post.closed:${args.organizationId}:${args.postId}:${statusUpdateId}:${now.getTime()}`,
            expiresAt: DateTime.fromDateUnsafe(now).pipe(
              DateTime.addDuration(Duration.days(7)),
              DateTime.toDate
            ),
            kind: "post.closed",
            organizationId: args.organizationId,
            payload: { kind: "post.closed", postId: args.postId },
            scheduledAt: now,
          })
          .pipe(
            Effect.mapError(
              () =>
                new InternalServerError({
                  message: "Could not record post closure email intent.",
                })
            )
          );
        return result._tag === "Inserted" ? result.intent.id : undefined;
      }
      const result = yield* emailOutbox
        .upsertPendingStatusChange({
          aggregateId: args.postId,
          aggregateType: "post",
          deduplicationKey: `post.status_changed:${args.organizationId}:${args.postId}:${now.getTime()}`,
          expiresAt: DateTime.fromDateUnsafe(now).pipe(
            DateTime.addDuration(Duration.millis(postStatusCoalescingDelayMs)),
            DateTime.addDuration(Duration.days(7)),
            DateTime.toDate
          ),
          organizationId: args.organizationId,
          payload: {
            kind: "post.status_changed",
            postId: args.postId,
            statusId: statusUpdateId,
          },
          scheduledAt: DateTime.fromDateUnsafe(now).pipe(
            DateTime.addDuration(Duration.millis(postStatusCoalescingDelayMs)),
            DateTime.toDate
          ),
        })
        .pipe(
          Effect.mapError(
            () =>
              new InternalServerError({
                message: "Could not record post status email intent.",
              })
          )
        );
      return result._tag === "Written" ? result.intent.id : undefined;
    }).pipe(
      Effect.mapError(
        () =>
          new FailedToCreateCommentError({
            message: "Failed to apply status update to post",
          })
      )
    );

    return { outboxId, statusUpdateId };
  }).pipe(
    Effect.mapError(
      () =>
        new FailedToCreateCommentError({
          message: "Failed to apply status update to post",
        })
    )
  );
};
