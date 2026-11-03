import { normalizeBoardQuery } from "@feeblo/domain-contracts/board-query";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { BoardRepository } from "../board/repository";
import * as Policy from "../policy";
import {
  BadRequestError,
  NotFoundError,
  withRemapDbErrors,
} from "../rpc-errors";
import { CurrentSession, type Session } from "../session-middleware";
import { SavedViewRepository } from "./repository";
import { SavedViewRpcs } from "./rpcs";
import type {
  TSavedViewCreate,
  TSavedViewDelete,
  TSavedViewList,
  TSavedViewReorder,
  TSavedViewUpdate,
} from "./schema";

/**
 * The session's member row for the workspace being written to.
 *
 * A session can hold memberships in several workspaces, and a saved view
 * belongs to exactly one of them, so the row is looked up per request rather
 * than assumed from the first membership. A session with no membership here is
 * already excluded by `Policy.hasMembership`; the failure is a defensive
 * `PolicyDeniedError` rather than an invented member id.
 */
const currentMemberId = (session: Session, organizationId: string) =>
  Effect.gen(function* () {
    const membership = Policy.getMembership(session, organizationId);
    if (membership === undefined) {
      return yield* new Policy.PolicyDeniedError({
        reason: "Not a member of this workspace",
      });
    }
    return membership.membershipId;
  });

/**
 * Trims a description and stores a blank one as `null`.
 *
 * The client's field is a plain text input, so "cleared" arrives as `""`. One
 * spelling of "no description" in the row is what lets the pill and the dialog
 * test a null rather than trying both.
 */
const normalizeDescription = (description: string | null): string | null => {
  const trimmed = description?.trim() ?? "";

  return trimmed === "" ? null : trimmed;
};

export const SavedViewRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* SavedViewRepository;
  const boardRepository = yield* BoardRepository;

  const list = ({ boardId, organizationId }: TSavedViewList) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const memberId = yield* currentMemberId(session, organizationId);
      return yield* repository.list({ boardId, memberId, organizationId });
    }).pipe(
      Policy.withPolicy(Policy.hasMembership(organizationId)),
      withRemapDbErrors("SavedView", "select")
    );

  const create = (args: TSavedViewCreate) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const memberId = yield* currentMemberId(session, args.organizationId);

      // A board-scoped view names a board by id, so the pair has to belong to
      // the same workspace as the view. A board from another workspace is not
      // found rather than forbidden, so the id cannot be used to probe one.
      if (args.boardId !== null) {
        const board = yield* boardRepository.findByIdInOrganization({
          id: args.boardId,
          organizationId: args.organizationId,
        });

        if (Option.isNone(board)) {
          return yield* new BadRequestError({ message: "Board not found" });
        }
      }

      yield* repository.create({
        ...args,
        description: normalizeDescription(args.description),
        // A payload from before sharing existed omits the flag; those views
        // were personal, so omitting it keeps them personal.
        isPrivate: args.isPrivate ?? true,
        memberId,
        // The row stores the canonical document, not the caller's spelling of
        // it: two clients that picked the same filters in a different order
        // write the same bytes, so a later comparison is structural.
        query: normalizeBoardQuery(args.query),
      });
    }).pipe(
      Policy.withPolicy(Policy.hasMembership(args.organizationId)),
      withRemapDbErrors("SavedView", "create")
    );

  const update = (args: TSavedViewUpdate) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const memberId = yield* currentMemberId(session, args.organizationId);
      // Ownership is checked by the predicate below rather than by the update
      // statement's row count: an update matching zero rows would otherwise
      // report success for a view that belongs to somebody else.
      const existing = yield* repository.findOwned({
        id: args.id,
        memberId,
        organizationId: args.organizationId,
      });
      if (existing === undefined) {
        return yield* new NotFoundError({ message: "Saved view not found" });
      }
      yield* repository.update({
        ...args,
        description: normalizeDescription(args.description),
        isPrivate: args.isPrivate ?? existing.isPrivate,
        memberId,
        query: normalizeBoardQuery(args.query),
      });
    }).pipe(
      Policy.withPolicy(Policy.hasMembership(args.organizationId)),
      withRemapDbErrors("SavedView", "update")
    );

  const remove = (args: TSavedViewDelete) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const memberId = yield* currentMemberId(session, args.organizationId);
      const existing = yield* repository.findOwned({
        id: args.id,
        memberId,
        organizationId: args.organizationId,
      });
      if (existing === undefined) {
        return yield* new NotFoundError({ message: "Saved view not found" });
      }
      yield* repository.remove({
        id: args.id,
        memberId,
        organizationId: args.organizationId,
      });
    }).pipe(
      Policy.withPolicy(Policy.hasMembership(args.organizationId)),
      withRemapDbErrors("SavedView", "delete")
    );

  /**
   * Rewrites the order of one surface's pills.
   *
   * The payload names every view it expects to reorder, so the set it sends is
   * checked against the set the member actually has before anything is written:
   * a stale client that missed a create or a delete is refused, rather than
   * silently leaving one view at its old index or reordering a row it no longer
   * owns.
   */
  const reorder = (args: TSavedViewReorder) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const memberId = yield* currentMemberId(session, args.organizationId);
      const existing = yield* repository.listOwned({
        boardId: args.boardId,
        memberId,
        organizationId: args.organizationId,
      });
      const existingIds = new Set(existing.map((view) => view.id));
      const orderedIds = new Set(args.orderedIds);

      if (
        existingIds.size !== orderedIds.size ||
        [...existingIds].some((id) => !orderedIds.has(id))
      ) {
        return yield* new BadRequestError({
          message: "Saved view order does not match this surface's views",
        });
      }

      yield* repository.reorder({
        boardId: args.boardId,
        memberId,
        orderedIds: args.orderedIds,
        organizationId: args.organizationId,
      });
    }).pipe(
      Policy.withPolicy(Policy.hasMembership(args.organizationId)),
      withRemapDbErrors("SavedView", "update")
    );

  return {
    ListSavedViews: list,
    CreateSavedView: create,
    UpdateSavedView: update,
    DeleteSavedView: remove,
    ReorderSavedViews: reorder,
  };
});

export const SavedViewRpcHandlers = SavedViewRpcs.toLayer(
  SavedViewRpcHandlersEffect
).pipe(
  Layer.provide(SavedViewRepository.layer),
  Layer.provide(BoardRepository.layer)
);
