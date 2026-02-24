import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { AuthMiddleware } from "../session-middleware";
import { Post, PostDelete, PostList } from "./schema";

export class PostRpcs extends RpcGroup.make(
  Rpc.make("PostList", {
    payload: PostList,
    success: Schema.Array(Post),
  }),

  Rpc.make("PostDelete", {
    success: Schema.Void,
    payload: PostDelete,
  })
).middleware(AuthMiddleware) {}
