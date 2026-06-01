import { Database, schema } from "@feeblo/db";
import { generateId } from "@feeblo/utils/id";
import type { ReactionEmoji } from "@feeblo/utils/reaction";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Array as EffectArray, Layer, Option } from "effect";

interface TPostReactionList {
  organizationId: string;
  postId: string;
}

interface TPostReactionToggle {
  emoji: ReactionEmoji;
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
  emoji: ReactionEmoji;
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
                .select({ id: schema.postTable.id })
                .from(schema.postTable)
                .where(
                  and(
                    eq(schema.postTable.id, input.postId),
                    eq(schema.postTable.organizationId, input.organizationId)
                  )
                )
                .limit(1)
            )
          )({ postId, organizationId })
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isNone(post)) {
          return [];
        }

        const reactions = yield* db.makeQuery(
          (execute, input: TPostReactionList) =>
            execute((client) =>
              client
                .select({
                  id: schema.postReactionTable.id,
                  postId: schema.postReactionTable.postId,
                  organizationId: schema.postTable.organizationId,
                  userId: schema.postReactionTable.userId,
                  memberId: schema.postReactionTable.memberId,
                  emoji: schema.postReactionTable.emoji,
                  createdAt: schema.postReactionTable.createdAt,
                  updatedAt: schema.postReactionTable.updatedAt,
                })
                .from(schema.postReactionTable)
                .innerJoin(
                  schema.postTable,
                  eq(schema.postTable.id, schema.postReactionTable.postId)
                )
                .where(
                  and(
                    eq(schema.postTable.organizationId, input.organizationId),
                    eq(schema.postReactionTable.postId, input.postId)
                  )
                )
            )
        )({ postId, organizationId });

        return reactions.map((reaction) => ({
          ...reaction,
          emoji: reaction.emoji,
        }));
      }),

    listPublic: ({ postId, organizationId }: TPostReactionList) =>
      Effect.gen(function* () {
        const post = yield* db
          .makeQuery((execute, input: TPostReactionList) =>
            execute((client) =>
              client
                .select({ id: schema.postTable.id })
                .from(schema.postTable)
                .innerJoin(
                  schema.boardTable,
                  eq(schema.boardTable.id, schema.postTable.boardId)
                )
                .where(
                  and(
                    eq(schema.postTable.id, input.postId),
                    eq(schema.postTable.organizationId, input.organizationId),
                    eq(schema.boardTable.visibility, "PUBLIC")
                  )
                )
                .limit(1)
            )
          )({ postId, organizationId })
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isNone(post)) {
          return [];
        }

        const reactions = yield* db.makeQuery(
          (execute, input: TPostReactionList) =>
            execute((client) =>
              client
                .select({
                  id: schema.postReactionTable.id,
                  postId: schema.postReactionTable.postId,
                  organizationId: schema.postTable.organizationId,
                  userId: schema.postReactionTable.userId,
                  memberId: schema.postReactionTable.memberId,
                  emoji: schema.postReactionTable.emoji,
                  createdAt: schema.postReactionTable.createdAt,
                  updatedAt: schema.postReactionTable.updatedAt,
                })
                .from(schema.postReactionTable)
                .innerJoin(
                  schema.postTable,
                  eq(schema.postTable.id, schema.postReactionTable.postId)
                )
                .where(
                  and(
                    eq(schema.postTable.organizationId, input.organizationId),
                    eq(schema.postReactionTable.postId, input.postId)
                  )
                )
            )
        )({ postId, organizationId });

        return reactions.map((reaction) => ({
          ...reaction,
          emoji: reaction.emoji,
        }));
      }),

    toggle: ({ organizationId, postId, userId, emoji }: TPostReactionToggle) =>
      Effect.gen(function* () {
        const post = yield* db
          .makeQuery((execute, input: TPostReactionToggle) =>
            execute((client) =>
              client
                .select({ id: schema.postTable.id })
                .from(schema.postTable)
                .where(
                  and(
                    eq(schema.postTable.id, input.postId),
                    eq(schema.postTable.organizationId, input.organizationId)
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
                .select({ id: schema.postReactionTable.id })
                .from(schema.postReactionTable)
                .where(
                  and(
                    eq(schema.postReactionTable.postId, input.postId),
                    eq(schema.postReactionTable.userId, input.userId),
                    eq(schema.postReactionTable.emoji, input.emoji)
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
                .delete(schema.postReactionTable)
                .where(eq(schema.postReactionTable.id, input.id))
            )
          )({ id: existingReaction.value.id });

          return { reacted: false, emoji: null };
        }

        const member = yield* db
          .makeQuery((execute, input: TFindMember) =>
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
          )({ organizationId, userId })
          .pipe(Effect.map(EffectArray.get(0)));

        yield* db.makeQuery((execute, input: TCreatePostReaction) =>
          execute((client) =>
            client.insert(schema.postReactionTable).values({
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
                .select({ id: schema.postTable.id })
                .from(schema.postTable)
                .innerJoin(
                  schema.boardTable,
                  eq(schema.boardTable.id, schema.postTable.boardId)
                )
                .where(
                  and(
                    eq(schema.postTable.id, input.postId),
                    eq(schema.postTable.organizationId, input.organizationId),
                    eq(schema.boardTable.visibility, "PUBLIC")
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
                .select({ id: schema.postReactionTable.id })
                .from(schema.postReactionTable)
                .where(
                  and(
                    eq(schema.postReactionTable.postId, input.postId),
                    eq(schema.postReactionTable.userId, input.userId),
                    eq(schema.postReactionTable.emoji, input.emoji)
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
                .delete(schema.postReactionTable)
                .where(eq(schema.postReactionTable.id, input.id))
            )
          )({ id: existingReaction.value.id });

          return { reacted: false, emoji: null };
        }

        const member = yield* db
          .makeQuery((execute, input: TFindMember) =>
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
          )({ organizationId, userId })
          .pipe(Effect.map(EffectArray.get(0)));

        yield* db.makeQuery((execute, input: TCreatePostReaction) =>
          execute((client) =>
            client.insert(schema.postReactionTable).values({
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
