import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { AuthMiddleware } from "../session-middleware";
import { PostStatusServiceErrors } from "./errors";
import { PostStatus, PostStatusList } from "./schema";

export class PostStatusRpcs extends RpcGroup.make(
  Rpc.make("PostStatusList", {
    success: Schema.Array(PostStatus),
    payload: PostStatusList,
    error: PostStatusServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("PostStatusListPublic", {
    success: Schema.Array(PostStatus),
    payload: PostStatusList,
    error: PostStatusServiceErrors,
  })
) {}
