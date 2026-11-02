import { currentDb, schema } from "@feeblo/db";
import type { TBoardQuery } from "@feeblo/domain-contracts/board-query";
import { and, asc, eq, isNull } from "drizzle-orm";
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
  id: schema.savedViewTable.id,
  memberId: schema.savedViewTable.memberId,
  name: schema.savedViewTable.name,
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
  readonly id: string;
  readonly name: string;
  readonly query: TBoardQuery;
}

interface TSavedViewUpdateInput extends TSavedViewOwner {
  readonly name: string;
  readonly query: TBoardQuery;
}

export const makeSavedViewRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  /**
   * A null `boardId` means the organization-wide feedback list, which is a
   * different surface from any board's list — `eq(column, null)` would compile
   * to `= null` and match nothing, so the two cases are separate predicates
   * rather than one helper pretending they are the same comparison.
   */
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
        .where(ownedScope(args))
        // Creation order rather than insertion id: a member's views are a
        // short hand-curated list, and the order they added them in is the
        // only stable one the client can predict.
        .orderBy(asc(schema.savedViewTable.createdAt)),

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

    create: ({
      boardId,
      id,
      memberId,
      name,
      organizationId,
      query,
    }: TSavedViewCreateInput) =>
      db
        .insert(schema.savedViewTable)
        .values({ boardId, id, memberId, name, organizationId, query })
        .pipe(Effect.asVoid),

    update: ({
      id,
      memberId,
      name,
      organizationId,
      query,
    }: TSavedViewUpdateInput) =>
      db
        .update(schema.savedViewTable)
        .set({ name, query })
        .where(
          and(
            eq(schema.savedViewTable.id, id),
            eq(schema.savedViewTable.organizationId, organizationId),
            eq(schema.savedViewTable.memberId, memberId)
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
