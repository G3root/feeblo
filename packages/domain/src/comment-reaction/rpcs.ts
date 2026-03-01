import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { AuthMiddleware } from "../session-middleware";
import { CommentReactionServiceErrors } from "./errors";
import {
  CommentReaction,
  CommentReactionList,
  CommentReactionToggle,
} from "./schema";

export class CommentReactionRpcs extends RpcGroup.make(
  Rpc.make("CommentReactionList", {
    payload: CommentReactionList,
    success: Schema.Array(CommentReaction),
    error: CommentReactionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("CommentReactionToggle", {
    payload: CommentReactionToggle,
    success: Schema.Struct({
      reacted: Schema.Boolean,
      emoji: Schema.Union(Schema.String, Schema.Null),
    }),
    error: CommentReactionServiceErrors,
  }).middleware(AuthMiddleware)
) {}
