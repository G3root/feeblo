import { Database, schema } from "@feeblo/db";
import { generateId } from "@feeblo/utils/id";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

type TPostReactionList = {
  postId: string;
  organizationId: string;
};

type TPostReactionToggle = {
  organizationId: string;
  postId: string;
  userId: string;
  emoji: string;
};

const makePostReactionRepository = Effect.gen(function* () {
  const db = yield* Database.Database;

  return {
    list: ({ postId, organizationId }: TPostReactionList) =>
      Effect.gen(function* () {
        const [post] = yield* db.makeQuery(
          (execute, input: TPostReactionList) =>
            execute((client) =>
              client
                .select({ id: schema.post.id })
                .from(schema.post)
                .where(
                  and(
                    eq(schema.post.id, input.postId),
                    eq(schema.post.organizationId, input.organizationId)
                  )
                )
                .limit(1)
            )
        )({ postId, organizationId });

        if (!post) {
          return [];
        }

        return yield* db.makeQuery(
          (execute, input: TPostReactionList) =>
            execute((client) =>
              client
                .select({
                  id: schema.postReaction.id,
                  postId: schema.postReaction.postId,
                  organizationId: schema.post.organizationId,
                  userId: schema.postReaction.userId,
                  memberId: schema.postReaction.memberId,
                  emoji: schema.postReaction.emoji,
                  createdAt: schema.postReaction.createdAt,
                  updatedAt: schema.postReaction.updatedAt,
                })
                .from(schema.postReaction)
                .innerJoin(
                  schema.post,
                  eq(schema.post.id, schema.postReaction.postId)
                )
                .where(
                  and(
                    eq(schema.post.organizationId, input.organizationId),
                    eq(schema.postReaction.postId, input.postId)
                  )
                )
            )
        )({ postId, organizationId });
      }),

    listPublic: ({ postId, organizationId }: TPostReactionList) =>
      Effect.gen(function* () {
        const [post] = yield* db.makeQuery(
          (execute, input: TPostReactionList) =>
            execute((client) =>
              client
                .select({ id: schema.post.id })
                .from(schema.post)
                .innerJoin(schema.board, eq(schema.board.id, schema.post.boardId))
                .where(
                  and(
                    eq(schema.post.id, input.postId),
                    eq(schema.post.organizationId, input.organizationId),
                    eq(schema.board.visibility, "PUBLIC")
                  )
                )
                .limit(1)
            )
        )({ postId, organizationId });

        if (!post) {
          return [];
        }

        return yield* db.makeQuery(
          (execute, input: TPostReactionList) =>
            execute((client) =>
              client
                .select({
                  id: schema.postReaction.id,
                  postId: schema.postReaction.postId,
                  organizationId: schema.post.organizationId,
                  userId: schema.postReaction.userId,
                  memberId: schema.postReaction.memberId,
                  emoji: schema.postReaction.emoji,
                  createdAt: schema.postReaction.createdAt,
                  updatedAt: schema.postReaction.updatedAt,
                })
                .from(schema.postReaction)
                .innerJoin(
                  schema.post,
                  eq(schema.post.id, schema.postReaction.postId)
                )
                .where(
                  and(
                    eq(schema.post.organizationId, input.organizationId),
                    eq(schema.postReaction.postId, input.postId)
                  )
                )
            )
        )({ postId, organizationId });
      }),

    toggle: ({ organizationId, postId, userId, emoji }: TPostReactionToggle) =>
      Effect.gen(function* () {
        const [post] = yield* db.makeQuery(
          (execute, input: TPostReactionToggle) =>
            execute((client) =>
              client
                .select({ id: schema.post.id })
                .from(schema.post)
                .where(
                  and(
                    eq(schema.post.id, input.postId),
                    eq(schema.post.organizationId, input.organizationId)
                  )
                )
                .limit(1)
            )
        )({ organizationId, postId, userId, emoji });

        if (!post) {
          return { reacted: false, emoji: null };
        }

        const [existingReaction] = yield* db.makeQuery(
          (execute, input: TPostReactionToggle) =>
            execute((client) =>
              client
                .select({ id: schema.postReaction.id })
                .from(schema.postReaction)
                .where(
                  and(
                    eq(schema.postReaction.postId, input.postId),
                    eq(schema.postReaction.userId, input.userId),
                    eq(schema.postReaction.emoji, input.emoji)
                  )
                )
                .limit(1)
            )
        )({ organizationId, postId, userId, emoji });

        if (existingReaction) {
          yield* db.makeQuery((execute, input: { id: string }) =>
            execute((client) =>
              client
                .delete(schema.postReaction)
                .where(eq(schema.postReaction.id, input.id))
            )
          )({ id: existingReaction.id });

          return { reacted: false, emoji: null };
        }

        const [member] = yield* db.makeQuery(
          (execute, input: { organizationId: string; userId: string }) =>
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
        )({ organizationId, userId });

        yield* db.makeQuery(
          (
            execute,
            input: {
              postId: string;
              userId: string;
              emoji: string;
              memberId: string | null;
            }
          ) =>
            execute((client) =>
              client.insert(schema.postReaction).values({
                id: generateId("postReaction"),
                postId: input.postId,
                userId: input.userId,
                memberId: input.memberId,
                emoji: input.emoji,
              })
            )
        )({
          postId,
          userId,
          emoji,
          memberId: member?.id ?? null,
        });

        return { reacted: true, emoji };
      }),

    togglePublic: ({
      organizationId,
      postId,
      userId,
      emoji,
    }: TPostReactionToggle) =>
      Effect.gen(function* () {
        const [post] = yield* db.makeQuery(
          (execute, input: TPostReactionToggle) =>
            execute((client) =>
              client
                .select({ id: schema.post.id })
                .from(schema.post)
                .innerJoin(schema.board, eq(schema.board.id, schema.post.boardId))
                .where(
                  and(
                    eq(schema.post.id, input.postId),
                    eq(schema.post.organizationId, input.organizationId),
                    eq(schema.board.visibility, "PUBLIC")
                  )
                )
                .limit(1)
            )
        )({ organizationId, postId, userId, emoji });

        if (!post) {
          return { reacted: false, emoji: null };
        }

        const [existingReaction] = yield* db.makeQuery(
          (execute, input: TPostReactionToggle) =>
            execute((client) =>
              client
                .select({ id: schema.postReaction.id })
                .from(schema.postReaction)
                .where(
                  and(
                    eq(schema.postReaction.postId, input.postId),
                    eq(schema.postReaction.userId, input.userId),
                    eq(schema.postReaction.emoji, input.emoji)
                  )
                )
                .limit(1)
            )
        )({ organizationId, postId, userId, emoji });

        if (existingReaction) {
          yield* db.makeQuery((execute, input: { id: string }) =>
            execute((client) =>
              client
                .delete(schema.postReaction)
                .where(eq(schema.postReaction.id, input.id))
            )
          )({ id: existingReaction.id });

          return { reacted: false, emoji: null };
        }

        const [member] = yield* db.makeQuery(
          (execute, input: { organizationId: string; userId: string }) =>
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
        )({ organizationId, userId });

        yield* db.makeQuery(
          (
            execute,
            input: {
              postId: string;
              userId: string;
              emoji: string;
              memberId: string | null;
            }
          ) =>
            execute((client) =>
              client.insert(schema.postReaction).values({
                id: generateId("postReaction"),
                postId: input.postId,
                userId: input.userId,
                memberId: input.memberId,
                emoji: input.emoji,
              })
            )
        )({
          postId,
          userId,
          emoji,
          memberId: member?.id ?? null,
        });

        return { reacted: true, emoji };
      }),
  };
});

export class PostReactionRepository extends Context.Service<PostReactionRepository>()(
  "PostReactionRepository",
  {
    make: makePostReactionRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
