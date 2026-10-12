import { currentDb, schema } from "@feeblo/db";
import { slugify } from "@feeblo/utils/url";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

interface TBoardCreate {
  /** Null when the board is created by an import whose uploader is gone. */
  creatorId: string | null;
  creatorMemberId: string | null;
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

interface TBoardFindPage {
  after: { readonly createdAt: Date; readonly id: string } | null;
  limit: number;
  organizationId: string;
}

interface TBoardFindByIdInOrganization {
  id: string;
  organizationId: string;
}

/**
 * The fields a board read selects, and the only place a board field is named.
 *
 * Shared by the dashboard's lists and the Public API's board reads so the two
 * cannot disagree about what a board is made of; a caller that must not expose
 * a field narrows the row rather than selecting a different set.
 */
const BOARD_FIELDS = {
  id: schema.boardTable.id,
  name: schema.boardTable.name,
  slug: schema.boardTable.slug,
  visibility: schema.boardTable.visibility,
  organizationId: schema.boardTable.organizationId,
  createdAt: schema.boardTable.createdAt,
  updatedAt: schema.boardTable.updatedAt,
} as const;

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
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        return yield* db
          .insert(schema.boardTable)
          .values({
            ...args,
            slug: slugify(args.name),
            createdAt: now,
            updatedAt: now,
          })
          .returning();
      }),
    findMany: ({ organizationId, visibility }: TBoardFindMany) =>
      Effect.gen(function* () {
        const where: SQL[] = [];
        if (visibility) {
          where.push(eq(schema.boardTable.visibility, visibility));
        }

        where.push(eq(schema.boardTable.organizationId, organizationId));

        const whereClause = where.length > 1 ? and(...where) : where[0];

        const boards = yield* db
          .select(BOARD_FIELDS)
          .from(schema.boardTable)
          .where(whereClause);

        return boards;
      }),

    /**
     * A page of the workspace's boards, newest first.
     *
     * Pages on the same `(createdAt, id)` tuple every other list uses, so a
     * caller that has learned one paging rule has learned this one too. Fetches
     * `limit + 1` rows so the caller learns whether another page exists without
     * a second query.
     */
    findPage: ({ after, limit, organizationId }: TBoardFindPage) => {
      const conditions = [
        eq(schema.boardTable.organizationId, organizationId),
        ...(after === null
          ? []
          : [
              sql`(${schema.boardTable.createdAt}, ${schema.boardTable.id}) < (${after.createdAt}, ${after.id})`,
            ]),
      ];

      return db
        .select(BOARD_FIELDS)
        .from(schema.boardTable)
        .where(and(...conditions))
        .orderBy(desc(schema.boardTable.createdAt), desc(schema.boardTable.id))
        .limit(limit + 1);
    },

    /**
     * One board of the workspace, with or without a session.
     *
     * Distinct from `findById`, which is the dashboard's member-scoped access
     * check, and from `getById`, which reads only the visibility the post write
     * path needs. A board of another workspace is not found rather than
     * forbidden, so the id cannot be used to probe another workspace.
     */
    findByIdInOrganization: ({
      id,
      organizationId,
    }: TBoardFindByIdInOrganization) =>
      db
        .select(BOARD_FIELDS)
        .from(schema.boardTable)
        .where(
          and(
            eq(schema.boardTable.id, id),
            eq(schema.boardTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .pipe(Effect.map(EffectArray.get(0))),

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
        const now = yield* DateTime.nowAsDate;

        return yield* db
          .update(schema.boardTable)
          .set({
            ...input,
            ...(input.name && { slug: slugify(input.name) }),
            updatedAt: now,
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
