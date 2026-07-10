import { currentDb, schema } from "@feeblo/db";
import { slugify } from "@feeblo/utils/url";
import { and, eq, type SQL } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

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

interface TBoardDelete {
  id: string;
  organizationId: string;
}

const makeBoardRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    findById: ({ id, organizationId, memberId }: TBoardFindById) =>
      db
        .select({ id: schema.boardTable.id })
        .from(schema.boardTable)
        .where(
          and(
            eq(schema.boardTable.id, id),
            eq(schema.boardTable.organizationId, organizationId),
            eq(schema.boardTable.creatorMemberId, memberId)
          )
        )
        .limit(1)
        .pipe(Effect.map(EffectArray.get(0))),
    getById: ({ id, organizationId }: TBoardGetById) =>
      db
        .select({
          id: schema.boardTable.id,
          visibility: schema.boardTable.visibility,
        })
        .from(schema.boardTable)
        .where(
          and(
            eq(schema.boardTable.id, id),
            eq(schema.boardTable.organizationId, organizationId)
          )
        )
        .pipe(Effect.map(EffectArray.get(0))),
    create: (args: TBoardCreate) =>
      db
        .insert(schema.boardTable)
        .values({
          ...args,
          slug: slugify(args.name),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning(),
    findMany: ({ organizationId, visibility }: TBoardFindMany) =>
      Effect.gen(function* () {
        const where: SQL[] = [];
        if (visibility) {
          where.push(eq(schema.boardTable.visibility, visibility));
        }

        where.push(eq(schema.boardTable.organizationId, organizationId));

        const whereClause = where.length > 1 ? and(...where) : where[0];

        const boards = yield* db
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
          .where(whereClause);

        return boards;
      }),
    countByOrganizationId: ({ organizationId }: { organizationId: string }) =>
      db
        .select({ id: schema.boardTable.id })
        .from(schema.boardTable)
        .where(eq(schema.boardTable.organizationId, organizationId))
        .pipe(Effect.map((boards) => boards.length)),

    delete: ({ id, organizationId }: TBoardDelete) =>
      db
        .delete(schema.boardTable)
        .where(
          and(
            eq(schema.boardTable.id, id),
            eq(schema.boardTable.organizationId, organizationId)
          )
        )
        .pipe(Effect.asVoid),
    update: (args: TBoardUpdate) =>
      Effect.gen(function* () {
        const { id, organizationId, ...rest } = args;
        const input = { id, organizationId, ...rest };

        return yield* db
          .update(schema.boardTable)
          .set({
            ...input,
            ...(input.name && { slug: slugify(input.name) }),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.boardTable.id, id),
              eq(schema.boardTable.organizationId, organizationId)
            )
          )
          .returning()
          .pipe(Effect.map(EffectArray.get(0)));
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
