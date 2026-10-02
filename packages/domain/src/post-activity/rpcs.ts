import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

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
