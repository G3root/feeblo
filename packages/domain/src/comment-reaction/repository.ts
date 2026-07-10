import { currentDb, schema } from "@feeblo/db";
import { CommentReactionId } from "@feeblo/id";
import type { ReactionEmoji } from "@feeblo/utils/reaction";
import { and, eq } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

interface TCommentReactionList {
  organizationId: string;
  postId: string;
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

  return {
    list: ({ organizationId, postId }: TCommentReactionList) =>
      db
        .select({
          id: schema.commentReactionTable.id,
          commentId: schema.commentReactionTable.commentId,
          postId: schema.commentTable.postId,
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
            eq(schema.commentTable.postId, postId)
          )
        )
        .pipe(
          Effect.map((reactions) =>
            reactions.map((reaction) => ({
              ...reaction,
              emoji: reaction.emoji as ReactionEmoji,
            }))
          )
        ),

    listPublic: ({ organizationId, postId }: TCommentReactionList) =>
      db
        .select({
          id: schema.commentReactionTable.id,
          commentId: schema.commentReactionTable.commentId,
          postId: schema.commentTable.postId,
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
            eq(schema.commentTable.postId, postId),
            eq(schema.boardTable.visibility, "PUBLIC")
          )
        )
        .pipe(
          Effect.map((reactions) =>
            reactions.map((reaction) => ({
              ...reaction,
              emoji: reaction.emoji as ReactionEmoji,
            }))
          )
        ),

    toggle: (args: TCommentReactionToggle) =>
      Effect.gen(function* () {
        const comment = yield* db
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
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isNone(comment)) {
          return { reacted: false, emoji: null };
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
          return { reacted: false, emoji: null };
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
            id: commentReactionId,
            commentId: args.commentId,
            userId: args.userId,
            memberId: Option.isSome(member) ? member.value.id : null,
            emoji: args.emoji,
          })
          .onConflictDoNothing();

        return { reacted: true, emoji: args.emoji };
      }),

    togglePublic: (args: TCommentReactionToggle) =>
      Effect.gen(function* () {
        const comment = yield* db
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
              eq(schema.boardTable.visibility, "PUBLIC")
            )
          )
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isNone(comment)) {
          return { reacted: false, emoji: null };
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
          return { reacted: false, emoji: null };
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
            id: commentReactionId,
            commentId: args.commentId,
            userId: args.userId,
            memberId: Option.isSome(member) ? member.value.id : null,
            emoji: args.emoji,
          })
          .onConflictDoNothing();

        return { reacted: true, emoji: args.emoji };
      }),
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
