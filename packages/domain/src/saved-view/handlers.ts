import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

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
 * The duplicate-name answer for both writes.
 *
 * A function rather than a shared error instance: an error object carries a
 * stack and is thrown once, so reusing one across requests would report the
 * first caller's location for every later conflict.
 */
const duplicateSavedViewName = () =>
  new BadRequestError({
    message: "A saved view with that name already exists",
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
      yield* repository.create({
        ...args,
        description: normalizeDescription(args.description),
        memberId,
      });
    }).pipe(
      Policy.withPolicy(Policy.hasMembership(args.organizationId)),
      // The unique index on (member, board, name) is what actually rejects a
      // duplicate name. It is a 400 rather than the generic 500 the other
      // entities' create paths answer with, because the name is the one value
      // the caller chose and can change.
      withRemapDbErrors({
        action: "create",
        entity: "SavedView",
        onUniqueViolation: duplicateSavedViewName,
      })
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
        memberId,
      });
    }).pipe(
      Policy.withPolicy(Policy.hasMembership(args.organizationId)),
      withRemapDbErrors({
        action: "update",
        entity: "SavedView",
        onUniqueViolation: duplicateSavedViewName,
      })
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
      const existing = yield* repository.list({
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
).pipe(Layer.provide(SavedViewRepository.layer));
