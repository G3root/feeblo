import * as Schema from "effect/Schema";

import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { AuthMiddleware, OptionalAuthMiddleware } from "../session-middleware";
import { ChangelogServiceErrors } from "./errors";
import {
  Changelog,
  ChangelogCreate,
  ChangelogDelete,
  ChangelogList,
  ChangelogUpdate,
} from "./schema";

export class ChangelogRpcs extends RpcGroup.make(
  Rpc.make("ChangelogList", {
    payload: ChangelogList,
    success: Schema.Array(Changelog),
    error: ChangelogServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ChangelogListPublic", {
    payload: ChangelogList,
    success: Schema.Array(Changelog),
    error: ChangelogServiceErrors,
  }).middleware(OptionalAuthMiddleware),

  Rpc.make("ChangelogCreate", {
    success: Schema.Void,
    payload: ChangelogCreate,
    error: ChangelogServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ChangelogDelete", {
    success: Schema.Void,
    payload: ChangelogDelete,
    error: ChangelogServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ChangelogUpdate", {
    success: Schema.Void,
    payload: ChangelogUpdate,
    error: ChangelogServiceErrors,
  }).middleware(AuthMiddleware)
) {}
