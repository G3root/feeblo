import { Database, schema } from "@feeblo/db";
import { slugify } from "@feeblo/utils/url";
import { and, eq, type SQL } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

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

type TBoardGetById = {
  id: string;
  organizationId: string;
};

const makeBoardRepository = Effect.gen(function* () {
  const db = yield* Database.Database;

  return {
    findById: ({ id, organizationId, memberId }: TBoardFindById) =>
      db
        .makeQuery((execute, input: TBoardFindById) =>
          execute((client) =>
            client
              .select({ id: schema.board.id })
              .from(schema.board)
              .where(
                and(
                  eq(schema.board.id, input.id),
                  eq(schema.board.organizationId, input.organizationId),
                  eq(schema.board.creatorMemberId, input.memberId)
                )
              )
          )
        )({ id, organizationId, memberId })
        .pipe(Effect.map((rows) => rows[0])),
    getById: ({ id, organizationId }: TBoardGetById) =>
      db
        .makeQuery((execute, input: TBoardGetById) =>
          execute((client) =>
            client
              .select({
                id: schema.board.id,
                visibility: schema.board.visibility,
              })
              .from(schema.board)
              .where(
                and(
                  eq(schema.board.id, input.id),
                  eq(schema.board.organizationId, input.organizationId)
                )
              )
          )
        )({ id, organizationId })
        .pipe(Effect.map((rows) => rows[0])),
    create: (args: TBoardCreate) =>
      db.makeQuery((execute, input: TBoardCreate) =>
        execute((client) =>
          client
            .insert(schema.board)
            .values({
              ...input,
              slug: slugify(input.name),
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning()
        )
      )(args),
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
          where.push(eq(schema.board.visibility, visibility));
        }

        where.push(eq(schema.board.organizationId, organizationId));

        const whereClause = where.length > 1 ? and(...where) : where[0];

        const boards = yield* db.makeQuery(
          (execute, input: { whereClause: SQL | undefined }) =>
            execute((client) =>
              client
                .select({
                  id: schema.board.id,
                  name: schema.board.name,
                  slug: schema.board.slug,
                  visibility: schema.board.visibility,
                  createdAt: schema.board.createdAt,
                  updatedAt: schema.board.updatedAt,
                  organizationId: schema.board.organizationId,
                })
                .from(schema.board)
                .where(input.whereClause)
            )
        )({ whereClause });

        return boards;
      }),
    countByOrganizationId: ({ organizationId }: { organizationId: string }) =>
      Effect.gen(function* () {
        const boards = yield* db.makeQuery(
          (execute, input: { organizationId: string }) =>
            execute((client) =>
              client
                .select({ id: schema.board.id })
                .from(schema.board)
                .where(eq(schema.board.organizationId, input.organizationId))
            )
        )({ organizationId });

        return boards.length;
      }),

    delete: ({ id, organizationId }: { id: string; organizationId: string }) =>
      Effect.gen(function* () {
        yield* db.makeQuery(
          (execute, input: { id: string; organizationId: string }) =>
            execute((client) =>
              client
                .delete(schema.board)
                .where(
                  and(
                    eq(schema.board.id, input.id),
                    eq(schema.board.organizationId, input.organizationId)
                  )
                )
            )
        )({ id, organizationId });
      }),
    update: (args: TBoardUpdate) =>
      Effect.gen(function* () {
        const { id, organizationId, ...rest } = args;

        const [updatedBoard] = yield* db.makeQuery(
          (
            execute,
            input: {
              id: string;
              organizationId: string;
              name?: string;
              visibility?: "PUBLIC" | "PRIVATE";
            }
          ) =>
            execute((client) =>
              client
                .update(schema.board)
                .set({
                  ...input,
                  ...(input.name && { slug: slugify(input.name) }),
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(schema.board.id, input.id),
                    eq(schema.board.organizationId, input.organizationId)
                  )
                )
                .returning()
            )
        )({ id, organizationId, ...rest });

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
