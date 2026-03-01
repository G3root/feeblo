import { DB } from "@feeblo/db";
import { member as memberTable } from "@feeblo/db/schema/auth";
import {
  post as postTable,
  postReaction as postReactionTable,
} from "@feeblo/db/schema/feedback";
import { generateId } from "@feeblo/utils/id";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

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

export class PostReactionRepository extends Effect.Service<PostReactionRepository>()(
  "PostReactionRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DB;

      return {
        list: ({ postId, organizationId }: TPostReactionList) =>
          Effect.gen(function* () {
            const [post] = yield* db
              .select({ id: postTable.id })
              .from(postTable)
              .where(
                and(
                  eq(postTable.id, postId),
                  eq(postTable.organizationId, organizationId)
                )
              )
              .limit(1);

            if (!post) {
              return [];
            }

            return yield* db
              .select({
                id: postReactionTable.id,
                postId: postReactionTable.postId,
                organizationId: postTable.organizationId,
                userId: postReactionTable.userId,
                memberId: postReactionTable.memberId,
                emoji: postReactionTable.emoji,
                createdAt: postReactionTable.createdAt,
                updatedAt: postReactionTable.updatedAt,
              })
              .from(postReactionTable)
              .innerJoin(postTable, eq(postTable.id, postReactionTable.postId))
              .where(
                and(
                  eq(postTable.organizationId, organizationId),
                  eq(postReactionTable.postId, postId)
                )
              );
          }),

        toggle: ({ organizationId, postId, userId, emoji }: TPostReactionToggle) =>
          Effect.gen(function* () {
            const [post] = yield* db
              .select({ id: postTable.id })
              .from(postTable)
              .where(
                and(
                  eq(postTable.id, postId),
                  eq(postTable.organizationId, organizationId)
                )
              )
              .limit(1);

            if (!post) {
              return { reacted: false, emoji: null };
            }

            const [existingReaction] = yield* db
              .select({
                id: postReactionTable.id,
              })
              .from(postReactionTable)
              .where(
                and(
                  eq(postReactionTable.postId, postId),
                  eq(postReactionTable.userId, userId),
                  eq(postReactionTable.emoji, emoji)
                )
              )
              .limit(1);

            if (existingReaction) {
              yield* db
                .delete(postReactionTable)
                .where(eq(postReactionTable.id, existingReaction.id));

              return { reacted: false, emoji: null };
            }

            const [member] = yield* db
              .select({ id: memberTable.id })
              .from(memberTable)
              .where(
                and(
                  eq(memberTable.organizationId, organizationId),
                  eq(memberTable.userId, userId)
                )
              )
              .limit(1);

            yield* db.insert(postReactionTable).values({
              id: generateId("postReaction"),
              postId,
              userId,
              memberId: member?.id ?? null,
              emoji,
            });

            return { reacted: true, emoji };
          }),
      };
    }),
  }
) {}
