import { DB } from "@feeblo/db";
import { board as boardTable } from "@feeblo/db/schema/feedback";
import { slugify } from "@feeblo/utils/url";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { Board } from "./schema";

type TBoardCreate = {
  name: string;
  visibility: "PUBLIC" | "PRIVATE";
  organizationId: string;
  id: string;
};

type TBoardUpdate = {
  id: string;
  name?: string;
  visibility?: "PUBLIC" | "PRIVATE";
  organizationId: string;
};

export class BoardRepository extends Effect.Service<BoardRepository>()(
  "BoardRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DB;

      return {
        create: (args: TBoardCreate) =>
          Effect.gen(function* () {
            const [newBoard] = yield* db
              .insert(boardTable)
              .values({
                ...args,
                slug: slugify(args.name),
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .returning();

            return newBoard;
          }),
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
                organizationId: boardTable.organizationId,
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
                  organizationId: entry.organizationId,
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
        update: (args: TBoardUpdate) =>
          Effect.gen(function* () {
            const { id, organizationId, ...rest } = args;

            const [updatedBoard] = yield* db
              .update(boardTable)
              .set({
                ...rest,
                ...(rest.name && { slug: slugify(rest.name) }),
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(boardTable.id, id),
                  eq(boardTable.organizationId, organizationId)
                )
              )
              .returning();

            return updatedBoard;
          }),
      };
    }),
  }
) {}
