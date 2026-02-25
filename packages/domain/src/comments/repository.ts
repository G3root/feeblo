import { DB } from "@feeblo/db";
import { user as userTable } from "@feeblo/db/schema/auth";
import { comment as commentTable } from "@feeblo/db/schema/feedback";
import { generateId } from "@feeblo/utils/id";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

type TCommentCreate = {
  organizationId: string;
  postId: string;
  content: string;
  userId: string;
  visibility: "PUBLIC" | "INTERNAL";
  parentCommentId: string | null;
};

export class CommentRepository extends Effect.Service<CommentRepository>()(
  "CommentRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DB;

      return {
        findMany: ({
          organizationId,
          postId,
        }: {
          organizationId: string;
          postId: string;
        }) =>
          Effect.gen(function* () {
            const rows = yield* db
              .select({
                id: commentTable.id,
                content: commentTable.content,
                createdAt: commentTable.createdAt,
                updatedAt: commentTable.updatedAt,
                organizationId: commentTable.organizationId,
                postId: commentTable.postId,
                userId: commentTable.userId,
                visibility: commentTable.visibility,
                parentCommentId: commentTable.parentCommentId,
                memberId: commentTable.memberId,
                user: {
                  name: userTable.name,
                },
              })
              .from(commentTable)
              .innerJoin(userTable, eq(commentTable.userId, userTable.id))
              .where(
                and(
                  eq(commentTable.organizationId, organizationId),
                  eq(commentTable.postId, postId)
                )
              );

            return rows;
          }),
        create: (args: TCommentCreate) =>
          Effect.gen(function* () {
            const [newComment] = yield* db
              .insert(commentTable)
              .values({
                ...args,
                id: generateId("comment"),
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .returning();
            return newComment;
          }),
      };
    }),
  }
) {}
