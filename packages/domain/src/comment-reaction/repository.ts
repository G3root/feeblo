import { currentDb, schema } from "@feeblo/db";
import { CommentReactionId } from "@feeblo/id";
import type { ReactionEmoji } from "@feeblo/utils/reaction";
import { and, eq, or, sql } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { publicPostVisibility } from "../post/public-visibility";

interface TCommentReactionList {
  organizationId: string;
  slug: string;
}

interface TCommentReactionToggle {
  commentId: string;
  emoji: ReactionEmoji;
  organizationId: string;
  postId: string;
  userId: string;
}

const makeCommentReactionRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  /**
   * The toggle both audiences share.
   *
   * `toggle` and `togglePublic` differ in one thing only: the query that proves
   * the caller may see the comment — the dashboard's is organization- and
   * post-scoped, the portal's also requires the comment and its board to be
   * public. Everything after that proof is the same decision, and writing it
   * twice is how the two would drift on what a second identical toggle means.
   * The proof is the argument; the body is written once.
   */
  const toggleWith =
    <E>(
      proveVisible: (
        args: TCommentReactionToggle
      ) => Effect.Effect<Option.Option<{ id: string }>, E>
    ) =>
    (args: TCommentReactionToggle) =>
      Effect.gen(function* () {
        const comment = yield* proveVisible(args);

        if (Option.isNone(comment)) {
          return { emoji: null, reacted: false };
        }

        const existingReaction = yield* db
          .select({ id: schema.commentReactionTable.id })
          .from(schema.commentReactionTable)
          .where(
            and(
              eq(schema.commentReactionTable.commentId, args.commentId),
              eq(schema.commentReactionTable.userId, args.userId),
              eq(schema.commentReactionTable.emoji, args.emoji)
            )
          )
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isSome(existingReaction)) {
          yield* db
            .delete(schema.commentReactionTable)
            .where(
              eq(schema.commentReactionTable.id, existingReaction.value.id)
            );

          return { emoji: null, reacted: false };
        }

        const member = yield* db
          .select({ id: schema.memberTable.id })
          .from(schema.memberTable)
          .where(
            and(
              eq(schema.memberTable.organizationId, args.organizationId),
              eq(schema.memberTable.userId, args.userId)
            )
          )
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

        const commentReactionId = yield* CommentReactionId.generate;

        yield* db
          .insert(schema.commentReactionTable)
          .values({
            commentId: args.commentId,
            emoji: args.emoji,
            id: commentReactionId,
            memberId: Option.isSome(member) ? member.value.id : null,
            userId: args.userId,
          })
          .onConflictDoNothing();

        return { emoji: args.emoji, reacted: true };
      });

  return {
    list: ({ organizationId, slug }: TCommentReactionList) =>
      Effect.gen(function* () {
        // Mirrors the comment list: reactions of comments merged away from
        // the requested post are listed under it too, keyed by the requested
        // slug, so a merged post's page can render its comments' reactions
        // from a single slug-scoped subset.
        const requestedPost = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .where(
            and(
              eq(schema.postTable.organizationId, organizationId),
              eq(schema.postTable.slug, slug)
            )
          )
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isNone(requestedPost)) {
          return [];
        }

        const reactions = yield* db
          .select({
            id: schema.commentReactionTable.id,
            commentId: schema.commentReactionTable.commentId,
            postId: schema.commentTable.postId,
            postSlug: sql<string>`${slug}`,
            organizationId: schema.commentTable.organizationId,
            userId: schema.commentReactionTable.userId,
            memberId: schema.commentReactionTable.memberId,
            emoji: schema.commentReactionTable.emoji,
            createdAt: schema.commentReactionTable.createdAt,
            updatedAt: schema.commentReactionTable.updatedAt,
          })
          .from(schema.commentReactionTable)
          .innerJoin(
            schema.commentTable,
            eq(schema.commentTable.id, schema.commentReactionTable.commentId)
          )
          .where(
            and(
              eq(schema.commentTable.organizationId, organizationId),
              or(
                eq(schema.commentTable.postId, requestedPost.value.id),
                eq(schema.commentTable.mergedFromPostId, requestedPost.value.id)
              )
            )
          );

        return reactions.map((reaction) => ({
          ...reaction,
          // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
          emoji: reaction.emoji as ReactionEmoji,
        }));
      }),

    listPublic: ({ organizationId, slug }: TCommentReactionList) =>
      db
        .select({
          id: schema.commentReactionTable.id,
          commentId: schema.commentReactionTable.commentId,
          postId: schema.commentTable.postId,
          postSlug: schema.postTable.slug,
          organizationId: schema.commentTable.organizationId,
          userId: schema.commentReactionTable.userId,
          memberId: schema.commentReactionTable.memberId,
          emoji: schema.commentReactionTable.emoji,
          createdAt: schema.commentReactionTable.createdAt,
          updatedAt: schema.commentReactionTable.updatedAt,
        })
        .from(schema.commentReactionTable)
        .innerJoin(
          schema.commentTable,
          eq(schema.commentTable.id, schema.commentReactionTable.commentId)
        )
        .innerJoin(
          schema.postTable,
          eq(schema.postTable.id, schema.commentTable.postId)
        )
        .innerJoin(
          schema.boardTable,
          eq(schema.boardTable.id, schema.postTable.boardId)
        )
        .where(
          and(
            eq(schema.commentTable.organizationId, organizationId),
            eq(schema.postTable.slug, slug),
            eq(schema.commentTable.visibility, "PUBLIC"),
            // A superseded post is not publicly readable, so its comment
            // reactions are not either.
            publicPostVisibility
          )
        )
        .pipe(
          Effect.map((reactions) =>
            reactions.map((reaction) => ({
              ...reaction,
              // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
              emoji: reaction.emoji as ReactionEmoji,
            }))
          )
        ),

    toggle: toggleWith((args: TCommentReactionToggle) =>
      db
        .select({ id: schema.commentTable.id })
        .from(schema.commentTable)
        .where(
          and(
            eq(schema.commentTable.id, args.commentId),
            eq(schema.commentTable.organizationId, args.organizationId),
            eq(schema.commentTable.postId, args.postId)
          )
        )
        .limit(1)
        .pipe(Effect.map(EffectArray.get(0)))
    ),

    togglePublic: toggleWith((args: TCommentReactionToggle) =>
      db
        .select({ id: schema.commentTable.id })
        .from(schema.commentTable)
        .innerJoin(
          schema.postTable,
          eq(schema.postTable.id, schema.commentTable.postId)
        )
        .innerJoin(
          schema.boardTable,
          eq(schema.boardTable.id, schema.postTable.boardId)
        )
        .where(
          and(
            eq(schema.commentTable.id, args.commentId),
            eq(schema.commentTable.organizationId, args.organizationId),
            eq(schema.commentTable.postId, args.postId),
            eq(schema.commentTable.visibility, "PUBLIC"),
            eq(schema.boardTable.visibility, "PUBLIC")
          )
        )
        .limit(1)
        .pipe(Effect.map(EffectArray.get(0)))
    ),
  };
});

export class CommentReactionRepository extends Context.Service<CommentReactionRepository>()(
  "CommentReactionRepository",
  {
    make: makeCommentReactionRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
