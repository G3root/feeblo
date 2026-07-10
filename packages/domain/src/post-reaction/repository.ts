import { schema, currentDb } from "@feeblo/db";
import { PostReactionId } from "@feeblo/id";
import type { ReactionEmoji } from "@feeblo/utils/reaction";
import { and, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as EffectArray from "effect/Array";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

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

const makePostReactionRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    list: ({ postId, organizationId }: TPostReactionList) =>
      Effect.gen(function* () {
        const post = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .where(
            and(
              eq(schema.postTable.id, postId),
              eq(schema.postTable.organizationId, organizationId)
            )
          )
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isNone(post)) {
          return [];
        }

        const reactions = yield* db
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
              eq(schema.postTable.organizationId, organizationId),
              eq(schema.postReactionTable.postId, postId)
            )
          );

        return reactions.map((reaction) => ({
          ...reaction,
          emoji: reaction.emoji as ReactionEmoji,
        }));
      }),

    listPublic: ({ postId, organizationId }: TPostReactionList) =>
      Effect.gen(function* () {
        const post = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .innerJoin(
            schema.boardTable,
            eq(schema.boardTable.id, schema.postTable.boardId)
          )
          .where(
            and(
              eq(schema.postTable.id, postId),
              eq(schema.postTable.organizationId, organizationId),
              eq(schema.boardTable.visibility, "PUBLIC")
            )
          )
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isNone(post)) {
          return [];
        }

        const reactions = yield* db
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
              eq(schema.postTable.organizationId, organizationId),
              eq(schema.postReactionTable.postId, postId)
            )
          );

        return reactions.map((reaction) => ({
          ...reaction,
          emoji: reaction.emoji as ReactionEmoji,
        }));
      }),

    toggle: ({ organizationId, postId, userId, emoji }: TPostReactionToggle) =>
      Effect.gen(function* () {
        const post = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .where(
            and(
              eq(schema.postTable.id, postId),
              eq(schema.postTable.organizationId, organizationId)
            )
          )
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isNone(post)) {
          return { reacted: false, emoji: null };
        }

        const existingReaction = yield* db
          .select({ id: schema.postReactionTable.id })
          .from(schema.postReactionTable)
          .where(
            and(
              eq(schema.postReactionTable.postId, postId),
              eq(schema.postReactionTable.userId, userId),
              eq(schema.postReactionTable.emoji, emoji)
            )
          )
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isSome(existingReaction)) {
          yield* db
            .delete(schema.postReactionTable)
            .where(eq(schema.postReactionTable.id, existingReaction.value.id));

          return { reacted: false, emoji: null };
        }

        const member = yield* db
          .select({ id: schema.memberTable.id })
          .from(schema.memberTable)
          .where(
            and(
              eq(schema.memberTable.organizationId, organizationId),
              eq(schema.memberTable.userId, userId)
            )
          )
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

        const postReactionId = yield* PostReactionId.generate;

        yield* db.insert(schema.postReactionTable).values({
          id: postReactionId,
          postId,
          userId,
          memberId: Option.match(member, {
            onNone: () => null,
            onSome: (value) => value.id,
          }),
          emoji,
        }).onConflictDoNothing();

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
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .innerJoin(
            schema.boardTable,
            eq(schema.boardTable.id, schema.postTable.boardId)
          )
          .where(
            and(
              eq(schema.postTable.id, postId),
              eq(schema.postTable.organizationId, organizationId),
              eq(schema.boardTable.visibility, "PUBLIC")
            )
          )
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isNone(post)) {
          return { reacted: false, emoji: null };
        }

        const existingReaction = yield* db
          .select({ id: schema.postReactionTable.id })
          .from(schema.postReactionTable)
          .where(
            and(
              eq(schema.postReactionTable.postId, postId),
              eq(schema.postReactionTable.userId, userId),
              eq(schema.postReactionTable.emoji, emoji)
            )
          )
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isSome(existingReaction)) {
          yield* db
            .delete(schema.postReactionTable)
            .where(eq(schema.postReactionTable.id, existingReaction.value.id));

          return { reacted: false, emoji: null };
        }

        const member = yield* db
          .select({ id: schema.memberTable.id })
          .from(schema.memberTable)
          .where(
            and(
              eq(schema.memberTable.organizationId, organizationId),
              eq(schema.memberTable.userId, userId)
            )
          )
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

        const postReactionId = yield* PostReactionId.generate;
        yield* db.insert(schema.postReactionTable).values({
          id: postReactionId,
          postId,
          userId,
          memberId: Option.match(member, {
            onNone: () => null,
            onSome: (value) => value.id,
          }),
          emoji,
        }).onConflictDoNothing();

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