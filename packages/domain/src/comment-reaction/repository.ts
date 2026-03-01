import { DB } from "@feeblo/db";
import { member as memberTable } from "@feeblo/db/schema/auth";
import {
  comment as commentTable,
  commentReaction as commentReactionTable,
} from "@feeblo/db/schema/feedback";
import { generateId } from "@feeblo/utils/id";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

type TCommentReactionList = {
  organizationId: string;
  postId: string;
};

type TCommentReactionToggle = {
  organizationId: string;
  postId: string;
  commentId: string;
  userId: string;
  emoji: string;
};

export class CommentReactionRepository extends Effect.Service<CommentReactionRepository>()(
  "CommentReactionRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DB;

      return {
        list: ({ organizationId, postId }: TCommentReactionList) =>
          Effect.gen(function* () {
            return yield* db
              .select({
                id: commentReactionTable.id,
                commentId: commentReactionTable.commentId,
                postId: commentTable.postId,
                organizationId: commentTable.organizationId,
                userId: commentReactionTable.userId,
                memberId: commentReactionTable.memberId,
                emoji: commentReactionTable.emoji,
                createdAt: commentReactionTable.createdAt,
                updatedAt: commentReactionTable.updatedAt,
              })
              .from(commentReactionTable)
              .innerJoin(commentTable, eq(commentTable.id, commentReactionTable.commentId))
              .where(
                and(
                  eq(commentTable.organizationId, organizationId),
                  eq(commentTable.postId, postId)
                )
              );
          }),
        toggle: ({
          organizationId,
          postId,
          commentId,
          userId,
          emoji,
        }: TCommentReactionToggle) =>
          Effect.gen(function* () {
            const [comment] = yield* db
              .select({ id: commentTable.id })
              .from(commentTable)
              .where(
                and(
                  eq(commentTable.id, commentId),
                  eq(commentTable.organizationId, organizationId),
                  eq(commentTable.postId, postId)
                )
              )
              .limit(1);

            if (!comment) {
              return { reacted: false, emoji: null };
            }

            const [existingReaction] = yield* db
              .select({ id: commentReactionTable.id })
              .from(commentReactionTable)
              .where(
                and(
                  eq(commentReactionTable.commentId, commentId),
                  eq(commentReactionTable.userId, userId),
                  eq(commentReactionTable.emoji, emoji)
                )
              )
              .limit(1);

            if (existingReaction) {
              yield* db
                .delete(commentReactionTable)
                .where(eq(commentReactionTable.id, existingReaction.id));
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

            yield* db.insert(commentReactionTable).values({
              id: generateId("commentReaction"),
              commentId,
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
