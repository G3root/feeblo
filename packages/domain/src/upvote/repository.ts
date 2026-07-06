import { currentDb, schema } from "@feeblo/db";
import { UpvoteId } from "@feeblo/id";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Array as EffectArray, Layer, Option } from "effect";

interface TUpvoteList {
  organizationId: string;
  visibility?: "PUBLIC" | "PRIVATE";
}

interface TUpvoteToggle {
  organizationId: string;
  postId: string;
  userId: string;
  visibility?: "PUBLIC" | "PRIVATE";
}

const makeUpvoteRepository = Effect.gen(function* () {
  return {
    list: ({ organizationId }: TUpvoteList) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
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
          .where(and(eq(schema.upvoteTable.organizationId, organizationId)));
      }),

    toggle: ({ organizationId, postId, userId, visibility }: TUpvoteToggle) =>
      Effect.gen(function* () {
        const operators = [
          eq(schema.postTable.id, postId),
          eq(schema.postTable.organizationId, organizationId),
          ...(visibility ? [eq(schema.boardTable.visibility, visibility)] : []),
        ];
        const db = yield* currentDb;
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
