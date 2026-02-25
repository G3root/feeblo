import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { AuthMiddleware } from "../session-middleware";
import { CommentServiceErrors } from "./errors";
import { Comment, CommentCreate, CommentList } from "./schema";

export class CommentRpcs extends RpcGroup.make(
  Rpc.make("CommentList", {
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
  })
).middleware(AuthMiddleware) {}
