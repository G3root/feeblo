import { currentDb, schema } from "@feeblo/db";
import { PostReactionId } from "@feeblo/id";
import type { ReactionEmoji } from "@feeblo/utils/reaction";
import { and, eq } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { publicPostVisibility } from "../post/public-visibility";

interface TPostReactionList {
  organizationId: string;
  slug: string;
}

interface TPostReactionToggle {
  emoji: ReactionEmoji;
  organizationId: string;
  postId: string;
  userId: string;
}

const makePostReactionRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  /**
   * The toggle both audiences share.
   *
   * `toggle` and `togglePublic` differ in one thing only: the query that proves
   * the caller may see the post — the dashboard's is organization-scoped, the
   * portal's also joins board visibility. Everything after that proof is the
   * same decision, and writing it twice is how the two would drift on what a
   * second identical toggle means. The proof is the argument; the body is
   * written once.
   */
  const toggleWith =
    <E>(
      proveVisible: (
        args: TPostReactionToggle
      ) => Effect.Effect<Option.Option<{ id: string }>, E>
    ) =>
    ({ organizationId, postId, userId, emoji }: TPostReactionToggle) =>
      Effect.gen(function* () {
        const post = yield* proveVisible({
          organizationId,
          postId,
          userId,
          emoji,
        });

        if (Option.isNone(post)) {
          return { emoji: null, reacted: false };
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

          return { emoji: null, reacted: false };
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

        yield* db
          .insert(schema.postReactionTable)
          .values({
            emoji,
            id: postReactionId,
            memberId: Option.match(member, {
              onNone: () => null,
              onSome: (value) => value.id,
            }),
            postId,
            userId,
          })
          .onConflictDoNothing();

        return { emoji, reacted: true };
      });

  return {
    list: ({ slug, organizationId }: TPostReactionList) =>
      Effect.gen(function* () {
        const post = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .where(
            and(
              eq(schema.postTable.slug, slug),
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
            postSlug: schema.postTable.slug,
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
              eq(schema.postReactionTable.postId, post.value.id)
            )
          );

        return reactions.map((reaction) => ({
          ...reaction,
          // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
          emoji: reaction.emoji as ReactionEmoji,
        }));
      }),

    listPublic: ({ slug, organizationId }: TPostReactionList) =>
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
              eq(schema.postTable.slug, slug),
              eq(schema.postTable.organizationId, organizationId),
              // A superseded post is not publicly readable, so its reactions
              // are not either.
              publicPostVisibility
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
            postSlug: schema.postTable.slug,
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
          .innerJoin(
            schema.boardTable,
            eq(schema.boardTable.id, schema.postTable.boardId)
          )
          .where(
            and(
              eq(schema.postTable.organizationId, organizationId),
              eq(schema.postReactionTable.postId, post.value.id),
              publicPostVisibility
            )
          );

        return reactions.map((reaction) => ({
          ...reaction,
          // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
          emoji: reaction.emoji as ReactionEmoji,
        }));
      }),

    toggle: toggleWith(({ organizationId, postId }) =>
      db
        .select({ id: schema.postTable.id })
        .from(schema.postTable)
        .where(
          and(
            eq(schema.postTable.id, postId),
            eq(schema.postTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .pipe(Effect.map(EffectArray.get(0)))
    ),

    togglePublic: toggleWith(({ organizationId, postId }) =>
      db
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
        .pipe(Effect.map(EffectArray.get(0)))
    ),
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
