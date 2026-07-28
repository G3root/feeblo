import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { AuthMiddleware } from "../session-middleware";
import { PostActivityServiceErrors } from "./errors";
import { PostActivity, PostActivityList } from "./schema";

export class PostActivityRpcs extends RpcGroup.make(
  Rpc.make("PostActivityList", {
    success: Schema.Array(PostActivity),
    error: PostActivityServiceErrors,
    payload: PostActivityList,
  }).middleware(AuthMiddleware)
) {}
