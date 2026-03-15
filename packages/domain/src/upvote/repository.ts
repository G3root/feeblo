import { DB } from "@feeblo/db";
import {
  member as memberTable,
  user as userTable,
} from "@feeblo/db/schema/auth";
import {
  post as postTable,
  upvote as upvoteTable,
} from "@feeblo/db/schema/feedback";
import { generateId } from "@feeblo/utils/id";
import { and, eq } from "drizzle-orm";
import { Effect, Array as EffectArray, Option } from "effect";

type TUpvoteList = {
  postId: string;
  organizationId: string;
};

type TUpvoteToggle = {
  organizationId: string;
  postId: string;
  userId: string;
};

export class UpvoteRepository extends Effect.Service<UpvoteRepository>()(
  "UpvoteRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DB;

      return {
        list: ({ postId, organizationId }: TUpvoteList) =>
          Effect.gen(function* () {
            const post = yield* db
              .select({ id: postTable.id })
              .from(postTable)
              .where(
                and(
                  eq(postTable.id, postId),
                  eq(postTable.organizationId, organizationId)
                )
              )
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

        toggle: ({ organizationId, postId, userId }: TUpvoteToggle) =>
          Effect.gen(function* () {
            const post = yield* db
              .select({ id: postTable.id })
              .from(postTable)
              .where(
                and(
                  eq(postTable.id, postId),
                  eq(postTable.organizationId, organizationId)
                )
              )
              .limit(1)
              .pipe(Effect.map(EffectArray.get(0)));

            if (Option.isNone(post)) {
              return { upvoted: false };
            }

            const existingUpvote = yield* db
              .select({ id: upvoteTable.id })
              .from(upvoteTable)
              .where(
                and(
                  eq(upvoteTable.postId, postId),
                  eq(upvoteTable.userId, userId)
                )
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
    }),
  }
) {}
