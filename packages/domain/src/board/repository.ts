import { DB } from "@feeblo/db";
import { board as boardTable } from "@feeblo/db/schema/feedback";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { Board } from "./schema";

export class BoardRepository extends Effect.Service<BoardRepository>()(
  "BoardRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DB;

      return {
        findMany: ({ organizationId }: { organizationId: string }) =>
          Effect.gen(function* () {
            const boards = yield* db
              .select({
                id: boardTable.id,
                name: boardTable.name,
                slug: boardTable.slug,
                visibility: boardTable.visibility,
                createdAt: boardTable.createdAt,
                updatedAt: boardTable.updatedAt,
              })
              .from(boardTable)
              .where(eq(boardTable.organizationId, organizationId));

            return boards.map(
              (entry) =>
                new Board({
                  id: entry.id,
                  name: entry.name,
                  slug: entry.slug,
                  visibility: entry.visibility,
                  createdAt: entry.createdAt,
                  updatedAt: entry.updatedAt,
                })
            );
          }),

        delete: ({
          id,
          organizationId,
        }: {
          id: string;
          organizationId: string;
        }) =>
          Effect.gen(function* () {
            yield* db
              .delete(boardTable)
              .where(
                and(
                  eq(boardTable.id, id),
                  eq(boardTable.organizationId, organizationId)
                )
              );
          }),
      };
    }),
  }
) {}
