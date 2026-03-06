import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { AuthMiddleware } from "../session-middleware";
import { BoardServiceErrors } from "./errors";
import {
  Board,
  BoardCreate,
  BoardDelete,
  BoardList,
  BoardUpdate,
} from "./schema";

export class BoardRpcs extends RpcGroup.make(
  Rpc.make("BoardList", {
    success: Schema.Array(Board),
    payload: BoardList,
    error: BoardServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("BoardListPublic", {
    success: Schema.Array(Board),
    payload: BoardList,
    error: BoardServiceErrors,
  }),

  Rpc.make("BoardDelete", {
    success: Schema.Void,
    payload: BoardDelete,
    error: BoardServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("BoardCreate", {
    success: Schema.Void,
    payload: BoardCreate,
    error: BoardServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("BoardUpdate", {
    success: Schema.Void,
    payload: BoardUpdate,
    error: BoardServiceErrors,
  }).middleware(AuthMiddleware)
) {}
