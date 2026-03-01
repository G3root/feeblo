import { DB } from "@feeblo/db";
import {
  post as postTable,
  upvote as upvoteTable,
} from "@feeblo/db/schema/feedback";
import { and, eq, type SQL, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { TPostUpdate } from "./schema";

type TPostFindMany = {
  boardId?: string | null | undefined;
  organizationId: string;
};

type TPostDelete = {
  id: string;
  organizationId: string;
  boardId: string;
};

export class PostRepository extends Effect.Service<PostRepository>()(
  "PostRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DB;

      return {
        findMany: ({ boardId, organizationId }: TPostFindMany) => {
          const where: SQL[] = [];
          if (boardId) {
            where.push(eq(postTable.boardId, boardId));
          }

          where.push(eq(postTable.organizationId, organizationId));

          const whereClause = where.length > 1 ? and(...where) : where[0];
          const upvoteCounts = db
            .select({
              postId: upvoteTable.postId,
              upVotes: sql<number>`count(*)::int`.as("upVotes"),
            })
            .from(upvoteTable)
            .groupBy(upvoteTable.postId)
            .as("upvote_counts");

          return db
            .select({
              id: postTable.id,
              title: postTable.title,
              boardId: postTable.boardId,
              slug: postTable.slug,
              content: postTable.content,
              upVotes: sql<number>`coalesce(${upvoteCounts.upVotes}, 0)`,
              status: postTable.status,
              createdAt: postTable.createdAt,
              updatedAt: postTable.updatedAt,
              organizationId: postTable.organizationId,
            })
            .from(postTable)
            .leftJoin(upvoteCounts, eq(upvoteCounts.postId, postTable.id))
            .where(whereClause);
        },

        update: ({
          id,
          organizationId,
          status,
          boardId,
          title,
          content,
        }: TPostUpdate) =>
          db
            .update(postTable)
            .set({ status, boardId, title, content })
            .where(
              and(
                eq(postTable.id, id),
                eq(postTable.organizationId, organizationId)
              )
            )
            .pipe(Effect.asVoid),

        delete: ({ id, organizationId, boardId }: TPostDelete) =>
          db
            .delete(postTable)
            .where(
              and(
                eq(postTable.id, id),
                eq(postTable.organizationId, organizationId),
                eq(postTable.boardId, boardId)
              )
            )
            .pipe(Effect.asVoid),
      };
    }),
  }
) {}
