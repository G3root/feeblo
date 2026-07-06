import * as Schema from "effect/Schema";

import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { AuthMiddleware } from "../session-middleware";
import { PostSubscriptionServiceErrors } from "./errors";
import {
  PostSubscription,
  PostSubscriptionCreate,
  PostSubscriptionDelete,
  PostSubscriptionList,
} from "./schema";

export class PostSubscriptionRpcs extends RpcGroup.make(
  Rpc.make("PostSubscriptionList", {
    payload: PostSubscriptionList,
    success: Schema.Array(PostSubscription),
    error: PostSubscriptionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("PostSubscriptionCreate", {
    payload: PostSubscriptionCreate,
    success: Schema.Struct({
      subscribed: Schema.Boolean,
    }),
    error: PostSubscriptionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("PostSubscriptionDelete", {
    payload: PostSubscriptionDelete,
    success: Schema.Struct({
      subscribed: Schema.Boolean,
    }),
    error: PostSubscriptionServiceErrors,
  }).middleware(AuthMiddleware)
) {}
