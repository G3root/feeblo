import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { AuthMiddleware } from "../session-middleware";
import { PostServiceErrors } from "./errors";
import { Post, PostDelete, PostList, PostUpdate } from "./schema";

export class PostRpcs extends RpcGroup.make(
  Rpc.make("PostList", {
    payload: PostList,
    success: Schema.Array(Post),
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PostListPublic", {
    payload: PostList,
    success: Schema.Array(Post),
    error: PostServiceErrors,
  }),

  Rpc.make("PostDelete", {
    success: Schema.Void,
    payload: PostDelete,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PostUpdate", {
    success: Schema.Void,
    payload: PostUpdate,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware)
) {}
