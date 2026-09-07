import { currentDb, schema } from "@feeblo/db";
import { UpvoteId } from "@feeblo/id";
import { and, eq } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

interface TUpvoteList {
  organizationId: string;
  /** Restricts the list to a single post. */
  postId?: string;
  /** Restricts the list to upvotes on public boards (used by public endpoints). */
  publicOnly?: boolean;
}

interface TUpvoteToggle {
  organizationId: string;
  postId: string;
  userId: string;
  visibility?: "PUBLIC" | "PRIVATE";
}

interface TUpvoteAs {
  organizationId: string;
  postId: string;
  /** The resolved subject's user row (a real account or a shadow user). */
  userId: string;
}

const makeUpvoteRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    list: ({ organizationId, publicOnly = false, postId }: TUpvoteList) =>
      db
        .select({
          id: schema.upvoteTable.id,
          postId: schema.upvoteTable.postId,
          organizationId: schema.upvoteTable.organizationId,
          userId: schema.upvoteTable.userId,
          user: {
            name: schema.userTable.name,
            image: schema.userTable.image,
          },
          memberId: schema.upvoteTable.memberId,
          createdAt: schema.upvoteTable.createdAt,
          updatedAt: schema.upvoteTable.updatedAt,
        })
        .from(schema.upvoteTable)
        .innerJoin(
          schema.userTable,
          eq(schema.userTable.id, schema.upvoteTable.userId)
        )
        .innerJoin(
          schema.postTable,
          eq(schema.postTable.id, schema.upvoteTable.postId)
        )
        .innerJoin(
          schema.boardTable,
          eq(schema.boardTable.id, schema.postTable.boardId)
        )
        .where(
          and(
            eq(schema.upvoteTable.organizationId, organizationId),
            ...(publicOnly ? [eq(schema.boardTable.visibility, "PUBLIC")] : []),
            ...(postId ? [eq(schema.upvoteTable.postId, postId)] : [])
          )
        ),

    toggle: ({ organizationId, postId, userId, visibility }: TUpvoteToggle) =>
      Effect.gen(function* () {
        const operators = [
          eq(schema.postTable.id, postId),
          eq(schema.postTable.organizationId, organizationId),
          ...(visibility ? [eq(schema.boardTable.visibility, visibility)] : []),
        ];
        const post = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .innerJoin(
            schema.boardTable,
            eq(schema.boardTable.id, schema.postTable.boardId)
          )
          .where(and(...operators))
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isNone(post)) {
          return { upvoted: false };
        }

        const existingUpvote = yield* db
          .select({ id: schema.upvoteTable.id })
          .from(schema.upvoteTable)
          .where(
            and(
              eq(schema.upvoteTable.postId, postId),
              eq(schema.upvoteTable.userId, userId)
            )
          )
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isSome(existingUpvote)) {
          yield* db
            .delete(schema.upvoteTable)
            .where(eq(schema.upvoteTable.id, existingUpvote.value.id));

          return { upvoted: false };
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

        const upvoteId = yield* UpvoteId.generate;
        yield* db
          .insert(schema.upvoteTable)
          .values({
            id: upvoteId,
            postId,
            userId,
            organizationId,
            memberId: Option.getOrNull(member)?.id ?? null,
          })
          .onConflictDoNothing();

        return { upvoted: true };
      }),

    /**
     * Inserts a vote for the resolved subject. Idempotent: an existing vote
     * is a success no-op via the `(userId, postId)` unique index.
     * `memberId` stays null unless the subject is actually an org member.
     */
    addAs: ({ organizationId, postId, userId }: TUpvoteAs) =>
      Effect.gen(function* () {
        const existingUpvote = yield* db
          .select({ id: schema.upvoteTable.id })
          .from(schema.upvoteTable)
          .where(
            and(
              eq(schema.upvoteTable.postId, postId),
              eq(schema.upvoteTable.userId, userId)
            )
          )
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isSome(existingUpvote)) {
          return { added: false };
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

        const upvoteId = yield* UpvoteId.generate;
        const inserted = yield* db
          .insert(schema.upvoteTable)
          .values({
            id: upvoteId,
            postId,
            userId,
            organizationId,
            memberId: Option.getOrNull(member)?.id ?? null,
          })
          .onConflictDoNothing()
          .returning({ id: schema.upvoteTable.id });

        // A lost race against the unique index is still an idempotent
        // success, but it must not report as a fresh add.
        return { added: inserted.length > 0 };
      }),

    /**
     * Deletes exactly the given subject's vote. Removing a non-voter is a
     * success no-op, not an error.
     */
    removeAs: ({ organizationId, postId, userId }: TUpvoteAs) =>
      Effect.gen(function* () {
        const deleted = yield* db
          .delete(schema.upvoteTable)
          .where(
            and(
              eq(schema.upvoteTable.postId, postId),
              eq(schema.upvoteTable.userId, userId),
              eq(schema.upvoteTable.organizationId, organizationId)
            )
          )
          .returning({ id: schema.upvoteTable.id });

        return { removed: deleted.length > 0 };
      }),
  };
});

export class UpvoteRepository extends Context.Service<UpvoteRepository>()(
  "UpvoteRepository",
  {
    make: makeUpvoteRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
