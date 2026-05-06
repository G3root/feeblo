import { DB } from "@feeblo/db";
import {
  member as memberTable,
  user as userTable,
} from "@feeblo/db/schema/auth";
import {
  board as boardTable,
  post as postTable,
  upvote as upvoteTable,
} from "@feeblo/db/schema/feedback";
import { generateId } from "@feeblo/utils/id";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Array as EffectArray, Layer, Option } from "effect";

type TUpvoteList = {
  postId: string;
  organizationId: string;
  visibility?: "PUBLIC" | "PRIVATE";
};

type TUpvoteToggle = {
  organizationId: string;
  postId: string;
  userId: string;
  visibility?: "PUBLIC" | "PRIVATE";
};

const makeUpvoteRepository = Effect.gen(function* () {
  const db = yield* DB;

  return {
    list: ({ postId, organizationId, visibility }: TUpvoteList) =>
      Effect.gen(function* () {
        const operators = [
          eq(postTable.id, postId),
          eq(postTable.organizationId, organizationId),
          ...(visibility ? [eq(boardTable.visibility, visibility)] : []),
        ];
        const post = yield* db
          .select({ id: postTable.id })
          .from(postTable)
          .innerJoin(boardTable, eq(boardTable.id, postTable.boardId))
          .where(and(...operators))
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isNone(post)) {
          return [];
        }

        return yield* db
          .select({
            id: upvoteTable.id,
            postId: upvoteTable.postId,
            organizationId: postTable.organizationId,
            userId: upvoteTable.userId,
            user: {
              name: userTable.name,
              image: userTable.image,
            },
            memberId: upvoteTable.memberId,
            createdAt: upvoteTable.createdAt,
            updatedAt: upvoteTable.updatedAt,
          })
          .from(upvoteTable)
          .innerJoin(postTable, eq(postTable.id, upvoteTable.postId))
          .innerJoin(userTable, eq(userTable.id, upvoteTable.userId))
          .where(
            and(
              eq(postTable.organizationId, organizationId),
              eq(upvoteTable.postId, postId)
            )
          );
      }),

    toggle: ({ organizationId, postId, userId, visibility }: TUpvoteToggle) =>
      Effect.gen(function* () {
        const operators = [
          eq(postTable.id, postId),
          eq(postTable.organizationId, organizationId),
          ...(visibility ? [eq(boardTable.visibility, visibility)] : []),
        ];
        const post = yield* db
          .select({ id: postTable.id })
          .from(postTable)
          .innerJoin(boardTable, eq(boardTable.id, postTable.boardId))
          .where(and(...operators))
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isNone(post)) {
          return { upvoted: false };
        }

        const existingUpvote = yield* db
          .select({ id: upvoteTable.id })
          .from(upvoteTable)
          .where(
            and(eq(upvoteTable.postId, postId), eq(upvoteTable.userId, userId))
          )
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isSome(existingUpvote)) {
          yield* db
            .delete(upvoteTable)
            .where(eq(upvoteTable.id, existingUpvote.value.id));

          return { upvoted: false };
        }

        const member = yield* db
          .select({ id: memberTable.id })
          .from(memberTable)
          .where(
            and(
              eq(memberTable.organizationId, organizationId),
              eq(memberTable.userId, userId)
            )
          )
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

        yield* db.insert(upvoteTable).values({
          id: generateId("upvote"),
          postId,
          userId,
          memberId: Option.getOrNull(member)?.id,
        });

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
