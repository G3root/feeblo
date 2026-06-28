import { Database, schema } from "@feeblo/db";
import { CommentReactionId } from "@feeblo/id";
import type { ReactionEmoji } from "@feeblo/utils/reaction";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Array as EffectArray, Layer, Option } from "effect";

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

interface TDeleteCommentReaction {
  id: string;
}

interface TCommentReactionCreate extends TCommentReactionToggle {
  memberId: string | null;
}

const makeCommentReactionRepository = Effect.gen(function* () {
  const db = yield* Database.Database;

  return {
    list: (args: TCommentReactionList) =>
      db
        .makeQuery((execute, input: TCommentReactionList) =>
          execute((client) =>
            client
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
                eq(
                  schema.commentTable.id,
                  schema.commentReactionTable.commentId
                )
              )
              .where(
                and(
                  eq(schema.commentTable.organizationId, input.organizationId),
                  eq(schema.commentTable.postId, input.postId)
                )
              )
          )
        )(args)
        .pipe(
          Effect.map((reactions) =>
            reactions.map((reaction) => ({
              ...reaction,
              //Todo : fix later
              emoji: reaction.emoji as ReactionEmoji,
            }))
          )
        ),

    listPublic: (args: TCommentReactionList) =>
      db
        .makeQuery((execute, input: TCommentReactionList) =>
          execute((client) =>
            client
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
                eq(
                  schema.commentTable.id,
                  schema.commentReactionTable.commentId
                )
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
                  eq(schema.commentTable.organizationId, input.organizationId),
                  eq(schema.commentTable.postId, input.postId),
                  eq(schema.boardTable.visibility, "PUBLIC")
                )
              )
          )
        )(args)
        .pipe(
          Effect.map((reactions) =>
            reactions.map((reaction) => ({
              ...reaction,
              //Todo : fix later
              emoji: reaction.emoji as ReactionEmoji,
            }))
          )
        ),

    toggle: (args: TCommentReactionToggle) =>
      Effect.gen(function* () {
        const comment = yield* db
          .makeQuery((execute, input: TCommentReactionToggle) =>
            execute((client) =>
              client
                .select({ id: schema.commentTable.id })
                .from(schema.commentTable)
                .where(
                  and(
                    eq(schema.commentTable.id, input.commentId),
                    eq(
                      schema.commentTable.organizationId,
                      input.organizationId
                    ),
                    eq(schema.commentTable.postId, input.postId)
                  )
                )
                .limit(1)
            )
          )(args)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isNone(comment)) {
          return { reacted: false, emoji: null };
        }

        const existingReaction = yield* db
          .makeQuery((execute, input: TCommentReactionToggle) =>
            execute((client) =>
              client
                .select({ id: schema.commentReactionTable.id })
                .from(schema.commentReactionTable)
                .where(
                  and(
                    eq(schema.commentReactionTable.commentId, input.commentId),
                    eq(schema.commentReactionTable.userId, input.userId),
                    eq(schema.commentReactionTable.emoji, input.emoji)
                  )
                )
                .limit(1)
            )
          )(args)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isSome(existingReaction)) {
          yield* db.makeQuery((execute, input: TDeleteCommentReaction) =>
            execute((client) =>
              client
                .delete(schema.commentReactionTable)
                .where(eq(schema.commentReactionTable.id, input.id))
            )
          )({ id: existingReaction.value.id });
          return { reacted: false, emoji: null };
        }

        const member = yield* db
          .makeQuery((execute, input: TCommentReactionToggle) =>
            execute((client) =>
              client
                .select({ id: schema.memberTable.id })
                .from(schema.memberTable)
                .where(
                  and(
                    eq(schema.memberTable.organizationId, input.organizationId),
                    eq(schema.memberTable.userId, input.userId)
                  )
                )
                .limit(1)
            )
          )(args)
          .pipe(Effect.map(EffectArray.get(0)));

        const commentReactionId = yield* CommentReactionId.generate;

        yield* db.makeQuery((execute, input: TCommentReactionCreate) =>
          execute((client) =>
            client.insert(schema.commentReactionTable).values({
              id: commentReactionId,
              commentId: input.commentId,
              userId: input.userId,
              memberId: input.memberId,
              emoji: input.emoji,
            })
          )
        )({
          ...args,
          memberId: Option.isSome(member) ? member.value.id : null,
        });

        return { reacted: true, emoji: args.emoji };
      }),

    togglePublic: (args: TCommentReactionToggle) =>
      Effect.gen(function* () {
        const comment = yield* db
          .makeQuery((execute, input: TCommentReactionToggle) =>
            execute((client) =>
              client
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
                    eq(schema.commentTable.id, input.commentId),
                    eq(
                      schema.commentTable.organizationId,
                      input.organizationId
                    ),
                    eq(schema.commentTable.postId, input.postId),
                    eq(schema.boardTable.visibility, "PUBLIC")
                  )
                )
                .limit(1)
            )
          )(args)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isNone(comment)) {
          return { reacted: false, emoji: null };
        }

        const existingReaction = yield* db
          .makeQuery((execute, input: TCommentReactionToggle) =>
            execute((client) =>
              client
                .select({ id: schema.commentReactionTable.id })
                .from(schema.commentReactionTable)
                .where(
                  and(
                    eq(schema.commentReactionTable.commentId, input.commentId),
                    eq(schema.commentReactionTable.userId, input.userId),
                    eq(schema.commentReactionTable.emoji, input.emoji)
                  )
                )
                .limit(1)
            )
          )(args)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isSome(existingReaction)) {
          yield* db.makeQuery((execute, input: TDeleteCommentReaction) =>
            execute((client) =>
              client
                .delete(schema.commentReactionTable)
                .where(eq(schema.commentReactionTable.id, input.id))
            )
          )({ id: existingReaction.value.id });
          return { reacted: false, emoji: null };
        }

        const member = yield* db.makeQuery(
          (execute, input: TCommentReactionToggle) =>
            execute((client) =>
              client
                .select({ id: schema.memberTable.id })
                .from(schema.memberTable)
                .where(
                  and(
                    eq(schema.memberTable.organizationId, input.organizationId),
                    eq(schema.memberTable.userId, input.userId)
                  )
                )
                .limit(1)
            ).pipe(Effect.map(EffectArray.get(0)))
        )(args);

        const commentReactionId = yield* CommentReactionId.generate;
        yield* db.makeQuery((execute, input: TCommentReactionCreate) =>
          execute((client) =>
            client.insert(schema.commentReactionTable).values({
              id: commentReactionId,
              commentId: input.commentId,
              userId: input.userId,
              memberId: input.memberId,
              emoji: input.emoji,
            })
          )
        )({
          ...args,
          memberId: Option.isSome(member) ? member.value.id : null,
        });

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
