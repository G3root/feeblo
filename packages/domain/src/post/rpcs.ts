import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { AuthMiddleware } from "../session-middleware";
import { PostServiceErrors } from "./errors";
import { Post, PostDelete, PostList } from "./schema";

export class PostRpcs extends RpcGroup.make(
  Rpc.make("PostList", {
    payload: PostList,
    success: Schema.Array(Post),
    error: PostServiceErrors,
  }),

  Rpc.make("PostDelete", {
    success: Schema.Void,
    payload: PostDelete,
    error: PostServiceErrors,
  })
).middleware(AuthMiddleware) {}
