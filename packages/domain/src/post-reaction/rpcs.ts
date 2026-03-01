import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { AuthMiddleware } from "../session-middleware";
import { PostReactionServiceErrors } from "./errors";
import {
  PostReaction,
  PostReactionList,
  PostReactionToggle,
} from "./schema";

export class PostReactionRpcs extends RpcGroup.make(
  Rpc.make("PostReactionList", {
    payload: PostReactionList,
    success: Schema.Array(PostReaction),
    error: PostReactionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("PostReactionToggle", {
    payload: PostReactionToggle,
    success: Schema.Struct({
      reacted: Schema.Boolean,
      emoji: Schema.Union(Schema.String, Schema.Null),
    }),
    error: PostReactionServiceErrors,
  }).middleware(AuthMiddleware)
) {}
