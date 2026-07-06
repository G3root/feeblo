import { ReactionEmojiSchema } from "@feeblo/utils/reaction";
import * as Schema from "effect/Schema";

import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { AuthMiddleware } from "../session-middleware";
import { PostReactionServiceErrors } from "./errors";
import { PostReaction, PostReactionList, PostReactionToggle } from "./schema";

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
      emoji: Schema.Union([ReactionEmojiSchema, Schema.Null]),
    }),
    error: PostReactionServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PostReactionListPublic", {
    payload: PostReactionList,
    success: Schema.Array(PostReaction),
    error: PostReactionServiceErrors,
  }),
  Rpc.make("PostReactionTogglePublic", {
    payload: PostReactionToggle,
    success: Schema.Struct({
      reacted: Schema.Boolean,
      emoji: Schema.Union([ReactionEmojiSchema, Schema.Null]),
    }),
    error: PostReactionServiceErrors,
  }).middleware(AuthMiddleware)
) {}
