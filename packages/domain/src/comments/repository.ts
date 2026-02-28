import { DB } from "@feeblo/db";
import { user as userTable } from "@feeblo/db/schema/auth";
import {
  comment as commentTable,
  type InsertComment,
} from "@feeblo/db/schema/feedback";
import { and, eq, type SQL } from "drizzle-orm";
import { Effect } from "effect";

type DeleteComment = {
  id: string;
  organizationId: string;
  postId: string;
  userId: string;
};

type UpdateComment = {
  id: string;
  organizationId: string;
  postId: string;
  content: string;
  userId: string;
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
          visibility,
        }: {
          organizationId: string;
          postId: string;
          visibility?: "PUBLIC" | "INTERNAL";
        }) =>
          Effect.gen(function* () {
            const where: SQL[] = [];
            if (visibility) {
              where.push(eq(commentTable.visibility, visibility));
            }

            where.push(eq(commentTable.organizationId, organizationId));
            where.push(eq(commentTable.postId, postId));

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
              .where(and(...where));

            return rows;
          }),
        create: (args: InsertComment) =>
          Effect.gen(function* () {
            const [newComment] = yield* db
              .insert(commentTable)
              .values({
                ...args,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .returning();
            return newComment;
          }),
        delete: (args: DeleteComment) =>
          Effect.gen(function* () {
            yield* db
              .delete(commentTable)
              .where(
                and(
                  eq(commentTable.id, args.id),
                  eq(commentTable.organizationId, args.organizationId),
                  eq(commentTable.postId, args.postId),
                  eq(commentTable.userId, args.userId)
                )
              );
          }),
        update: (args: UpdateComment) =>
          Effect.gen(function* () {
            const [updatedComment] = yield* db
              .update(commentTable)
              .set({
                content: args.content,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(commentTable.id, args.id),
                  eq(commentTable.organizationId, args.organizationId),
                  eq(commentTable.postId, args.postId),
                  eq(commentTable.userId, args.userId)
                )
              )
              .returning();
            return updatedComment;
          }),
      };
    }),
  }
) {}
