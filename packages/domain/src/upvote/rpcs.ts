import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { AuthMiddleware } from "../session-middleware";
import { UpvoteServiceErrors } from "./errors";
import { Upvote, UpvoteList, UpvoteToggle } from "./schema";

export class UpvoteRpcs extends RpcGroup.make(
  Rpc.make("UpvoteList", {
    payload: UpvoteList,
    success: Schema.Array(Upvote),
    error: UpvoteServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("UpvoteToggle", {
    payload: UpvoteToggle,
    success: Schema.Struct({
      upvoted: Schema.Boolean,
    }),
    error: UpvoteServiceErrors,
  }).middleware(AuthMiddleware)
) {}
