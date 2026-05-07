import { Database, schema } from "@feeblo/db";
import { generateId } from "@feeblo/utils/id";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Array as EffectArray, Layer, Option } from "effect";

interface TPostReactionList {
  organizationId: string;
  postId: string;
}

interface TPostReactionToggle {
  emoji: string;
  organizationId: string;
  postId: string;
  userId: string;
}

interface TDeletePostReaction {
  id: string;
}

interface TFindMember {
  organizationId: string;
  userId: string;
}

interface TCreatePostReaction {
  emoji: string;
  memberId: string | null;
  postId: string;
  userId: string;
}

const makePostReactionRepository = Effect.gen(function* () {
  const db = yield* Database.Database;

  return {
    list: ({ postId, organizationId }: TPostReactionList) =>
      Effect.gen(function* () {
        const post = yield* db
          .makeQuery((execute, input: TPostReactionList) =>
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
          )({ postId, organizationId })
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isNone(post)) {
          return [];
        }

        return yield* db.makeQuery((execute, input: TPostReactionList) =>
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
        const post = yield* db
          .makeQuery((execute, input: TPostReactionList) =>
            execute((client) =>
              client
                .select({ id: schema.post.id })
                .from(schema.post)
                .innerJoin(
                  schema.board,
                  eq(schema.board.id, schema.post.boardId)
                )
                .where(
                  and(
                    eq(schema.post.id, input.postId),
                    eq(schema.post.organizationId, input.organizationId),
                    eq(schema.board.visibility, "PUBLIC")
                  )
                )
                .limit(1)
            )
          )({ postId, organizationId })
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isNone(post)) {
          return [];
        }

        return yield* db.makeQuery((execute, input: TPostReactionList) =>
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
        const post = yield* db
          .makeQuery((execute, input: TPostReactionToggle) =>
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
          )({ organizationId, postId, userId, emoji })
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isNone(post)) {
          return { reacted: false, emoji: null };
        }

        const existingReaction = yield* db
          .makeQuery((execute, input: TPostReactionToggle) =>
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
          )({ organizationId, postId, userId, emoji })
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isSome(existingReaction)) {
          yield* db.makeQuery((execute, input: TDeletePostReaction) =>
            execute((client) =>
              client
                .delete(schema.postReaction)
                .where(eq(schema.postReaction.id, input.id))
            )
          )({ id: existingReaction.value.id });

          return { reacted: false, emoji: null };
        }

        const member = yield* db
          .makeQuery((execute, input: TFindMember) =>
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
          )({ organizationId, userId })
          .pipe(Effect.map(EffectArray.get(0)));

        yield* db.makeQuery((execute, input: TCreatePostReaction) =>
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
          memberId: Option.match(member, {
            onNone: () => null,
            onSome: (value) => value.id,
          }),
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
        const post = yield* db
          .makeQuery((execute, input: TPostReactionToggle) =>
            execute((client) =>
              client
                .select({ id: schema.post.id })
                .from(schema.post)
                .innerJoin(
                  schema.board,
                  eq(schema.board.id, schema.post.boardId)
                )
                .where(
                  and(
                    eq(schema.post.id, input.postId),
                    eq(schema.post.organizationId, input.organizationId),
                    eq(schema.board.visibility, "PUBLIC")
                  )
                )
                .limit(1)
            )
          )({ organizationId, postId, userId, emoji })
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isNone(post)) {
          return { reacted: false, emoji: null };
        }

        const existingReaction = yield* db
          .makeQuery((execute, input: TPostReactionToggle) =>
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
          )({ organizationId, postId, userId, emoji })
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isSome(existingReaction)) {
          yield* db.makeQuery((execute, input: TDeletePostReaction) =>
            execute((client) =>
              client
                .delete(schema.postReaction)
                .where(eq(schema.postReaction.id, input.id))
            )
          )({ id: existingReaction.value.id });

          return { reacted: false, emoji: null };
        }

        const member = yield* db
          .makeQuery((execute, input: TFindMember) =>
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
          )({ organizationId, userId })
          .pipe(Effect.map(EffectArray.get(0)));

        yield* db.makeQuery((execute, input: TCreatePostReaction) =>
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
          memberId: Option.match(member, {
            onNone: () => null,
            onSome: (value) => value.id,
          }),
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
