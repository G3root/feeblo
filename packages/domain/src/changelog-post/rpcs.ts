import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { AuthMiddleware } from "../session-middleware";
import { ChangelogPostServiceErrors } from "./errors";
import {
  ChangelogPost,
  ChangelogPostCreate,
  ChangelogPostDelete,
  ChangelogPostList,
} from "./schema";

export class ChangelogPostRpcs extends RpcGroup.make(
  Rpc.make("ChangelogPostList", {
    payload: ChangelogPostList,
    success: Schema.Array(ChangelogPost),
    error: ChangelogPostServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ChangelogPostCreate", {
    payload: ChangelogPostCreate,
    success: Schema.Void,
    error: ChangelogPostServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ChangelogPostDelete", {
    payload: ChangelogPostDelete,
    success: Schema.Void,
    error: ChangelogPostServiceErrors,
  }).middleware(AuthMiddleware)
) {}
