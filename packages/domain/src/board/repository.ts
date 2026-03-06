import { DB } from "@feeblo/db";
import { board as boardTable } from "@feeblo/db/schema/feedback";
import { slugify } from "@feeblo/utils/url";
import { and, eq, type SQL } from "drizzle-orm";
import { Effect, Array as EffectArray } from "effect";
import { Board } from "./schema";

type TBoardCreate = {
  name: string;
  visibility: "PUBLIC" | "PRIVATE";
  organizationId: string;
  id: string;
  creatorId: string;
  creatorMemberId: string;
};

type TBoardUpdate = {
  id: string;
  name?: string;
  visibility?: "PUBLIC" | "PRIVATE";
  organizationId: string;
};

type TBoardFindById = {
  id: string;
  organizationId: string;
  memberId: string;
};

export class BoardRepository extends Effect.Service<BoardRepository>()(
  "BoardRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DB;

      return {
        findById: ({ id, organizationId, memberId }: TBoardFindById) =>
          db
            .select({ id: boardTable.id })
            .from(boardTable)
            .where(
              and(
                eq(boardTable.id, id),
                eq(boardTable.organizationId, organizationId),
                eq(boardTable.creatorMemberId, memberId)
              )
            )
            .pipe(Effect.map(EffectArray.get(0))),
        create: (args: TBoardCreate) =>
          db
            .insert(boardTable)
            .values({
              ...args,
              slug: slugify(args.name),
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning(),
        findMany: ({
          organizationId,
          visibility,
        }: {
          organizationId: string;
          visibility?: "PUBLIC" | "PRIVATE";
        }) =>
          Effect.gen(function* () {
            const where: SQL[] = [];
            if (visibility) {
              where.push(eq(boardTable.visibility, visibility));
            }

            where.push(eq(boardTable.organizationId, organizationId));

            const whereClause = where.length > 1 ? and(...where) : where[0];

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
              .where(whereClause);

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
