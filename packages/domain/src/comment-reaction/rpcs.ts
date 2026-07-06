import { ReactionEmojiSchema } from "@feeblo/utils/reaction";
import * as Schema from "effect/Schema";

import { Rpc, RpcGroup } from "effect/unstable/rpc";
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
      emoji: Schema.Union([ReactionEmojiSchema, Schema.Null]),
    }),
    error: CommentReactionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("CommentReactionListPublic", {
    payload: CommentReactionList,
    success: Schema.Array(CommentReaction),
    error: CommentReactionServiceErrors,
  }),
  Rpc.make("CommentReactionTogglePublic", {
    payload: CommentReactionToggle,
    success: Schema.Struct({
      reacted: Schema.Boolean,
      emoji: Schema.Union([ReactionEmojiSchema, Schema.Null]),
    }),
    error: CommentReactionServiceErrors,
  }).middleware(AuthMiddleware)
) {}
