import { currentDb, schema } from "@feeblo/db";
import { BoardId, PostStatusId } from "@feeblo/id";
import { and, eq } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { recordPostIntegrationEvent as recordPostIntegrationEventShared } from "../integration/post-event-recording";
import { PostActivityRepository } from "../post-activity/repository";
import { FailedToCreateCommentError } from "./errors";
import type { TCommentCreate } from "./schema";
import type { CommentActor } from "./service";

/**
 * Moves a post to the org-scoped status a comment request names, and records
 * the `STATUS_CHANGED` activity plus integration event mirroring the post
 * editor path.
 *
 * It lives beside the shared write service rather than inside it because the
 * Public API never moves a post's status through a comment, and the services
 * this needs — an integration-event recorder, an email config, a post
 * repository, the id generator — would otherwise become requirements of a
 * route that never exercises them. The dashboard hands the effect to
 * `CommentService.create`, which runs it inside the create's own transaction,
 * so the comment, the timeline entry, and the status change still commit or
 * roll back together.
 *
 * Returns the id to store on the comment, or null when nothing actually
 * changed: a post already in that status is not labeled a status update.
 */
export const applyCommentStatusUpdate = (
  args: TCommentCreate,
  actor: CommentActor
) => {
  const statusUpdateId = args.statusUpdateId ?? null;
  return Effect.gen(function* () {
    if (statusUpdateId === null || args.parentCommentId !== null) {
      // Replies and plain comments never move the post's status.
      return null;
    }
    const db = yield* currentDb;
    const activityRepository = yield* PostActivityRepository;

    // Resolve the org-scoped status row the request refers to.
    const statusRow = yield* db
      .select({ id: schema.postStatusTable.id })
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
      return null;
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
      return null;
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
      return null;
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
      eventType: "feedback.post.status_changed",
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

    return statusUpdateId;
  }).pipe(
    Effect.mapError(
      () =>
        new FailedToCreateCommentError({
          message: "Failed to apply status update to post",
        })
    )
  );
};
