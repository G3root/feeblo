import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { AuthMiddleware } from "../session-middleware";
import { SavedViewServiceErrors } from "./errors";
import {
  SavedView,
  SavedViewCreate,
  SavedViewDelete,
  SavedViewList,
  SavedViewReorder,
  SavedViewUpdate,
} from "./schema";

/**
 * A member's own saved board queries.
 *
 * Every RPC requires a dashboard session: a saved view is personal, so there is
 * no public-portal or Public API counterpart, and a machine key has no member
 * to own one. Ownership is never taken from the payload — the handler scopes on
 * the session's member for the requested workspace.
 */
export class SavedViewRpcs extends RpcGroup.make(
  Rpc.make("ListSavedViews", {
    payload: SavedViewList,
    success: Schema.Array(SavedView),
    error: SavedViewServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("CreateSavedView", {
    payload: SavedViewCreate,
    success: Schema.Void,
    error: SavedViewServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("UpdateSavedView", {
    payload: SavedViewUpdate,
    success: Schema.Void,
    error: SavedViewServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("DeleteSavedView", {
    payload: SavedViewDelete,
    success: Schema.Void,
    error: SavedViewServiceErrors,
  }).middleware(AuthMiddleware),

  // The pills' drag order. A whole list rather than a single move: positions
  // are only meaningful relative to each other.
  Rpc.make("ReorderSavedViews", {
    payload: SavedViewReorder,
    success: Schema.Void,
    error: SavedViewServiceErrors,
  }).middleware(AuthMiddleware)
) {}
