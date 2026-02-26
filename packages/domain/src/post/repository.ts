import { DB } from "@feeblo/db";
import { post as postTable } from "@feeblo/db/schema/feedback";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import type { TPostUpdate } from "./schema";

type TPostFindMany = {
  boardId: string;
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
        findMany: ({ boardId, organizationId }: TPostFindMany) =>
          db
            .select({
              id: postTable.id,
              title: postTable.title,
              boardId: postTable.boardId,
              slug: postTable.slug,
              content: postTable.content,
              status: postTable.status,
              createdAt: postTable.createdAt,
              updatedAt: postTable.updatedAt,
              organizationId: postTable.organizationId,
            })
            .from(postTable)
            .where(
              and(
                eq(postTable.boardId, boardId),
                eq(postTable.organizationId, organizationId)
              )
            ),

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
