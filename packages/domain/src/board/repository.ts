import { Database, schema } from "@feeblo/db";
import { slugify } from "@feeblo/utils/url";
import { and, eq, type SQL } from "drizzle-orm";
import { Context, Effect, Array as EffectArray, Layer } from "effect";

interface TBoardCreate {
  creatorId: string;
  creatorMemberId: string;
  id: string;
  name: string;
  organizationId: string;
  visibility: "PUBLIC" | "PRIVATE";
}

interface TBoardUpdate {
  id: string;
  name?: string;
  organizationId: string;
  visibility?: "PUBLIC" | "PRIVATE";
}

interface TBoardFindById {
  id: string;
  memberId: string;
  organizationId: string;
}

interface TBoardGetById {
  id: string;
  organizationId: string;
}

interface TBoardFindMany {
  organizationId: string;
  visibility?: "PUBLIC" | "PRIVATE";
}

interface TBoardWhereClauseQuery {
  whereClause: SQL | undefined;
}

interface TBoardCountByOrganizationId {
  organizationId: string;
}

interface TBoardDelete {
  id: string;
  organizationId: string;
}

interface TBoardUpdateInput extends TBoardUpdate {
  name?: string;
  visibility?: "PUBLIC" | "PRIVATE";
}

const makeBoardRepository = Effect.gen(function* () {
  const db = yield* Database.Database;

  return {
    findById: ({ id, organizationId, memberId }: TBoardFindById) =>
      db
        .makeQuery((execute, input: TBoardFindById) =>
          execute((client) =>
            client
              .select({ id: schema.boardTable.id })
              .from(schema.boardTable)
              .where(
                and(
                  eq(schema.boardTable.id, input.id),
                  eq(schema.boardTable.organizationId, input.organizationId),
                  eq(schema.boardTable.creatorMemberId, input.memberId)
                )
              )
          )
        )({ id, organizationId, memberId })
        .pipe(Effect.map(EffectArray.get(0))),
    getById: ({ id, organizationId }: TBoardGetById) =>
      db
        .makeQuery((execute, input: TBoardGetById) =>
          execute((client) =>
            client
              .select({
                id: schema.boardTable.id,
                visibility: schema.boardTable.visibility,
              })
              .from(schema.boardTable)
              .where(
                and(
                  eq(schema.boardTable.id, input.id),
                  eq(schema.boardTable.organizationId, input.organizationId)
                )
              )
          )
        )({ id, organizationId })
        .pipe(Effect.map(EffectArray.get(0))),
    create: (args: TBoardCreate) =>
      db.makeQuery((execute, input: TBoardCreate) =>
        execute((client) =>
          client
            .insert(schema.boardTable)
            .values({
              ...input,
              slug: slugify(input.name),
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning()
        )
      )(args),
    findMany: ({ organizationId, visibility }: TBoardFindMany) =>
      Effect.gen(function* () {
        const where: SQL[] = [];
        if (visibility) {
          where.push(eq(schema.boardTable.visibility, visibility));
        }

        where.push(eq(schema.boardTable.organizationId, organizationId));

        const whereClause = where.length > 1 ? and(...where) : where[0];

        const boards = yield* db.makeQuery(
          (execute, input: TBoardWhereClauseQuery) =>
            execute((client) =>
              client
                .select({
                  id: schema.boardTable.id,
                  name: schema.boardTable.name,
                  slug: schema.boardTable.slug,
                  visibility: schema.boardTable.visibility,
                  createdAt: schema.boardTable.createdAt,
                  updatedAt: schema.boardTable.updatedAt,
                  organizationId: schema.boardTable.organizationId,
                })
                .from(schema.boardTable)
                .where(input.whereClause)
            )
        )({ whereClause });

        return boards;
      }),
    countByOrganizationId: ({ organizationId }: TBoardCountByOrganizationId) =>
      Effect.gen(function* () {
        const boards = yield* db.makeQuery(
          (execute, input: TBoardCountByOrganizationId) =>
            execute((client) =>
              client
                .select({ id: schema.boardTable.id })
                .from(schema.boardTable)
                .where(
                  eq(schema.boardTable.organizationId, input.organizationId)
                )
            )
        )({ organizationId });

        return boards.length;
      }),

    delete: ({ id, organizationId }: TBoardDelete) =>
      db
        .makeQuery((execute, input: TBoardDelete) =>
          execute((client) =>
            client
              .delete(schema.boardTable)
              .where(
                and(
                  eq(schema.boardTable.id, input.id),
                  eq(schema.boardTable.organizationId, input.organizationId)
                )
              )
          )
        )({ id, organizationId })
        .pipe(Effect.asVoid),
    update: (args: TBoardUpdate) =>
      Effect.gen(function* () {
        const { id, organizationId, ...rest } = args;

        const updatedBoard = yield* db
          .makeQuery((execute, input: TBoardUpdateInput) =>
            execute((client) =>
              client
                .update(schema.boardTable)
                .set({
                  ...input,
                  ...(input.name && { slug: slugify(input.name) }),
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(schema.boardTable.id, input.id),
                    eq(schema.boardTable.organizationId, input.organizationId)
                  )
                )
                .returning()
            )
          )({ id, organizationId, ...rest })
          .pipe(Effect.map(EffectArray.get(0)));

        return updatedBoard;
      }),
  };
});

export class BoardRepository extends Context.Service<BoardRepository>()(
  "BoardRepository",
  {
    make: makeBoardRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
