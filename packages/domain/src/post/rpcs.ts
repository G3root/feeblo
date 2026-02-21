import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { Post } from "./schema";

export class PostRpcs extends RpcGroup.make(
  Rpc.make("PostList", {
    success: Schema.Array(Post),
  }),

  Rpc.make("PostDelete", {
    success: Schema.Void,
    payload: {
      id: Schema.String,
    },
  })
) {}
