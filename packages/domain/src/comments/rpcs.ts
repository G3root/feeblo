import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { AuthMiddleware } from "../session-middleware";
import { CommentServiceErrors } from "./errors";
import {
  Comment,
  CommentCreate,
  CommentDelete,
  CommentList,
  CommentUpdate,
} from "./schema";

export class CommentRpcs extends RpcGroup.make(
  Rpc.make("CommentList", {
    success: Schema.Array(Comment),
    error: CommentServiceErrors,
    payload: CommentList,
  }).middleware(AuthMiddleware),
  Rpc.make("CommentListPublic", {
    success: Schema.Array(Comment),
    error: CommentServiceErrors,
    payload: CommentList,
  }),
  Rpc.make("CommentCreate", {
    success: Schema.Struct({
      message: Schema.String,
    }),
    error: CommentServiceErrors,
    payload: CommentCreate,
  }).middleware(AuthMiddleware),
  Rpc.make("CommentDelete", {
    success: Schema.Struct({
      message: Schema.String,
    }),
    error: CommentServiceErrors,
    payload: CommentDelete,
  }).middleware(AuthMiddleware),
  Rpc.make("CommentUpdate", {
    success: Schema.Struct({
      message: Schema.String,
    }),
    error: CommentServiceErrors,
    payload: CommentUpdate,
  }).middleware(AuthMiddleware)
) {}
