import { Database, schema } from "@feeblo/db";
import { generateId } from "@feeblo/utils/id";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Array as EffectArray, Layer, Option } from "effect";

interface TCommentReactionList {
  organizationId: string;
  postId: string;
}

interface TCommentReactionToggle {
  commentId: string;
  emoji: string;
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
      db.makeQuery((execute, input: TCommentReactionList) =>
        execute((client) =>
          client
            .select({
              id: schema.commentReaction.id,
              commentId: schema.commentReaction.commentId,
              postId: schema.comment.postId,
              organizationId: schema.comment.organizationId,
              userId: schema.commentReaction.userId,
              memberId: schema.commentReaction.memberId,
              emoji: schema.commentReaction.emoji,
              createdAt: schema.commentReaction.createdAt,
              updatedAt: schema.commentReaction.updatedAt,
            })
            .from(schema.commentReaction)
            .innerJoin(
              schema.comment,
              eq(schema.comment.id, schema.commentReaction.commentId)
            )
            .where(
              and(
                eq(schema.comment.organizationId, input.organizationId),
                eq(schema.comment.postId, input.postId)
              )
            )
        )
      )(args),

    listPublic: (args: TCommentReactionList) =>
      db.makeQuery((execute, input: TCommentReactionList) =>
        execute((client) =>
          client
            .select({
              id: schema.commentReaction.id,
              commentId: schema.commentReaction.commentId,
              postId: schema.comment.postId,
              organizationId: schema.comment.organizationId,
              userId: schema.commentReaction.userId,
              memberId: schema.commentReaction.memberId,
              emoji: schema.commentReaction.emoji,
              createdAt: schema.commentReaction.createdAt,
              updatedAt: schema.commentReaction.updatedAt,
            })
            .from(schema.commentReaction)
            .innerJoin(
              schema.comment,
              eq(schema.comment.id, schema.commentReaction.commentId)
            )
            .innerJoin(schema.post, eq(schema.post.id, schema.comment.postId))
            .innerJoin(schema.board, eq(schema.board.id, schema.post.boardId))
            .where(
              and(
                eq(schema.comment.organizationId, input.organizationId),
                eq(schema.comment.postId, input.postId),
                eq(schema.board.visibility, "PUBLIC")
              )
            )
        )
      )(args),

    toggle: (args: TCommentReactionToggle) =>
      Effect.gen(function* () {
        const comment = yield* db
          .makeQuery((execute, input: TCommentReactionToggle) =>
            execute((client) =>
              client
                .select({ id: schema.comment.id })
                .from(schema.comment)
                .where(
                  and(
                    eq(schema.comment.id, input.commentId),
                    eq(schema.comment.organizationId, input.organizationId),
                    eq(schema.comment.postId, input.postId)
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
                .select({ id: schema.commentReaction.id })
                .from(schema.commentReaction)
                .where(
                  and(
                    eq(schema.commentReaction.commentId, input.commentId),
                    eq(schema.commentReaction.userId, input.userId),
                    eq(schema.commentReaction.emoji, input.emoji)
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
                .delete(schema.commentReaction)
                .where(eq(schema.commentReaction.id, input.id))
            )
          )({ id: existingReaction.value.id });
          return { reacted: false, emoji: null };
        }

        const member = yield* db
          .makeQuery((execute, input: TCommentReactionToggle) =>
            execute((client) =>
              client
                .select({ id: schema.member.id })
                .from(schema.member)
                .where(
                  and(
                    eq(schema.member.organizationId, input.organizationId),
                    eq(schema.member.userId, input.userId)
                  )
                )
                .limit(1)
            )
          )(args)
          .pipe(Effect.map(EffectArray.get(0)));

        yield* db.makeQuery((execute, input: TCommentReactionCreate) =>
          execute((client) =>
            client.insert(schema.commentReaction).values({
              id: generateId("commentReaction"),
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
                .select({ id: schema.comment.id })
                .from(schema.comment)
                .innerJoin(
                  schema.post,
                  eq(schema.post.id, schema.comment.postId)
                )
                .innerJoin(
                  schema.board,
                  eq(schema.board.id, schema.post.boardId)
                )
                .where(
                  and(
                    eq(schema.comment.id, input.commentId),
                    eq(schema.comment.organizationId, input.organizationId),
                    eq(schema.comment.postId, input.postId),
                    eq(schema.board.visibility, "PUBLIC")
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
                .select({ id: schema.commentReaction.id })
                .from(schema.commentReaction)
                .where(
                  and(
                    eq(schema.commentReaction.commentId, input.commentId),
                    eq(schema.commentReaction.userId, input.userId),
                    eq(schema.commentReaction.emoji, input.emoji)
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
                .delete(schema.commentReaction)
                .where(eq(schema.commentReaction.id, input.id))
            )
          )({ id: existingReaction.value.id });
          return { reacted: false, emoji: null };
        }

        const member = yield* db.makeQuery(
          (execute, input: TCommentReactionToggle) =>
            execute((client) =>
              client
                .select({ id: schema.member.id })
                .from(schema.member)
                .where(
                  and(
                    eq(schema.member.organizationId, input.organizationId),
                    eq(schema.member.userId, input.userId)
                  )
                )
                .limit(1)
            ).pipe(Effect.map(EffectArray.get(0)))
        )(args);

        yield* db.makeQuery((execute, input: TCommentReactionCreate) =>
          execute((client) =>
            client.insert(schema.commentReaction).values({
              id: generateId("commentReaction"),
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
