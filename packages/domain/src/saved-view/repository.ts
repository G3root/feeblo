import { currentDb, schema } from "@feeblo/db";
import type { TBoardQuery } from "@feeblo/domain-contracts/board-query";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/**
 * The fields a saved view read selects, named once so the list and the
 * single-row read cannot drift from the advertised schema.
 */
const SAVED_VIEW_FIELDS = {
  boardId: schema.savedViewTable.boardId,
  createdAt: schema.savedViewTable.createdAt,
  description: schema.savedViewTable.description,
  id: schema.savedViewTable.id,
  isPrivate: schema.savedViewTable.isPrivate,
  memberId: schema.savedViewTable.memberId,
  name: schema.savedViewTable.name,
  orderIndex: schema.savedViewTable.orderIndex,
  organizationId: schema.savedViewTable.organizationId,
  query: schema.savedViewTable.query,
  updatedAt: schema.savedViewTable.updatedAt,
} as const;

interface TSavedViewOwner {
  readonly id: string;
  readonly memberId: string;
  readonly organizationId: string;
}

interface TSavedViewListInput {
  readonly boardId: string | null;
  readonly memberId: string;
  readonly organizationId: string;
}

interface TSavedViewCreateInput extends TSavedViewListInput {
  readonly description: string | null;
  readonly id: string;
  readonly isPrivate: boolean;
  readonly name: string;
  readonly query: TBoardQuery;
}

interface TSavedViewUpdateInput extends TSavedViewOwner {
  readonly description: string | null;
  readonly isPrivate: boolean;
  readonly name: string;
  readonly query: TBoardQuery;
}

interface TSavedViewReorderInput extends TSavedViewListInput {
  readonly orderedIds: readonly string[];
}

export const makeSavedViewRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  /**
   * Everything this member may see: their own views on the surface, plus the
   * views other members have shared with the workspace. A private view is
   * visible only to its owner, which is the one predicate the whole module
   * turns on.
   */
  const visibleScope = (args: TSavedViewListInput) =>
    and(
      eq(schema.savedViewTable.organizationId, args.organizationId),
      args.boardId === null
        ? isNull(schema.savedViewTable.boardId)
        : eq(schema.savedViewTable.boardId, args.boardId),
      or(
        eq(schema.savedViewTable.memberId, args.memberId),
        eq(schema.savedViewTable.isPrivate, false)
      )
    );

  const ownedScope = (args: TSavedViewListInput) =>
    and(
      eq(schema.savedViewTable.organizationId, args.organizationId),
      eq(schema.savedViewTable.memberId, args.memberId),
      args.boardId === null
        ? isNull(schema.savedViewTable.boardId)
        : eq(schema.savedViewTable.boardId, args.boardId)
    );

  return {
    list: (args: TSavedViewListInput) =>
      db
        .select(SAVED_VIEW_FIELDS)
        .from(schema.savedViewTable)
        .where(visibleScope(args))
        // Position first, creation second: `orderIndex` is what the drag
        // rewrites, and `createdAt` breaks the tie two rows can share when a
        // create raced another on the same surface.
        .orderBy(
          asc(schema.savedViewTable.orderIndex),
          asc(schema.savedViewTable.createdAt)
        ),

    /**
     * The member's own views only.
     *
     * Reordering is the one list operation that writes rows, so it is checked
     * against the owned list rather than the visible one: a member may see a
     * colleague's shared view, but may not move it.
     */
    listOwned: (args: TSavedViewListInput) =>
      db
        .select(SAVED_VIEW_FIELDS)
        .from(schema.savedViewTable)
        .where(ownedScope(args))
        .orderBy(
          asc(schema.savedViewTable.orderIndex),
          asc(schema.savedViewTable.createdAt)
        ),

    findOwned: ({ id, memberId, organizationId }: TSavedViewOwner) =>
      db
        .select(SAVED_VIEW_FIELDS)
        .from(schema.savedViewTable)
        .where(
          and(
            eq(schema.savedViewTable.id, id),
            eq(schema.savedViewTable.organizationId, organizationId),
            eq(schema.savedViewTable.memberId, memberId)
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows[0])),

    /**
     * Inserts a view at the end of its surface.
     *
     * The position is computed by the statement itself rather than read first:
     * a read-then-insert has a window where two creates take the same index,
     * and the subquery inside `values` closes it without a transaction or a
     * lock. `is not distinct from` is what lets the same expression serve the
     * feedback list (whose `board_id` is null) and a board.
     */
    create: ({
      boardId,
      description,
      id,
      isPrivate,
      memberId,
      name,
      organizationId,
      query,
    }: TSavedViewCreateInput) =>
      db
        .insert(schema.savedViewTable)
        .values({
          boardId,
          description,
          id,
          isPrivate,
          memberId,
          name,
          organizationId,
          orderIndex: sql`(
            select coalesce(max(${schema.savedViewTable.orderIndex}), -1) + 1
            from ${schema.savedViewTable}
            where ${schema.savedViewTable.memberId} = ${memberId}
              and ${schema.savedViewTable.boardId} is not distinct from ${boardId}
          )`,
          query,
        })
        .pipe(Effect.asVoid),

    update: ({
      description,
      id,
      isPrivate,
      memberId,
      name,
      organizationId,
      query,
    }: TSavedViewUpdateInput) =>
      db
        .update(schema.savedViewTable)
        .set({ description, isPrivate, name, query })
        .where(
          and(
            eq(schema.savedViewTable.id, id),
            eq(schema.savedViewTable.organizationId, organizationId),
            eq(schema.savedViewTable.memberId, memberId)
          )
        )
        .pipe(Effect.asVoid),

    /**
     * Rewrites the position of one surface's views in a single statement.
     *
     * A `CASE` over the named ids rather than a loop of updates: a drag is one
     * change to the list, and a half-applied order is not a state the board
     * should be able to observe. Callers validate that `orderedIds` names
     * exactly the member's views on this surface before calling; the `where`
     * clause is the same scope, so an id from another member or surface is
     * simply not matched.
     */
    reorder: ({
      boardId,
      memberId,
      orderedIds,
      organizationId,
    }: TSavedViewReorderInput) =>
      db
        .update(schema.savedViewTable)
        .set({
          orderIndex: sql`case ${schema.savedViewTable.id} ${sql.join(
            orderedIds.map((id, index) => sql`when ${id} then ${index}`),
            sql` `
          )} else ${schema.savedViewTable.orderIndex} end`,
        })
        .where(
          and(
            ownedScope({ boardId, memberId, organizationId }),
            inArray(schema.savedViewTable.id, [...orderedIds])
          )
        )
        .pipe(Effect.asVoid),

    remove: ({ id, memberId, organizationId }: TSavedViewOwner) =>
      db
        .delete(schema.savedViewTable)
        .where(
          and(
            eq(schema.savedViewTable.id, id),
            eq(schema.savedViewTable.organizationId, organizationId),
            eq(schema.savedViewTable.memberId, memberId)
          )
        )
        .pipe(Effect.asVoid),
  };
});

export class SavedViewRepository extends Context.Service<SavedViewRepository>()(
  "SavedViewRepository",
  {
    make: makeSavedViewRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
