import * as Schema from "effect/Schema";

import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware, OptionalAuthMiddleware } from "../session-middleware";
import { TagServiceErrors } from "./errors";
import {
  ChangelogTagAssignment,
  ChangelogTagList,
  ChangelogTagSet,
  PostTagAssignment,
  PostTagList,
  PostTagSet,
  Tag,
  TagCreate,
  TagDelete,
  TagList,
  TagUpdate,
} from "./schema";

export class TagRpcs extends RpcGroup.make(
  Rpc.make("TagList", {
    payload: TagList,
    success: Schema.Array(Tag),
    error: TagServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("TagListPublic", {
    payload: TagList,
    success: Schema.Array(Tag),
    error: Schema.Union([TagServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("TagCreate", {
    payload: TagCreate,
    success: Schema.Void,
    error: TagServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("TagUpdate", {
    payload: TagUpdate,
    success: Schema.Void,
    error: TagServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("TagDelete", {
    payload: TagDelete,
    success: Schema.Void,
    error: TagServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PostTagList", {
    payload: PostTagList,
    success: Schema.Array(PostTagAssignment),
    error: TagServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PostTagListPublic", {
    payload: PostTagList,
    success: Schema.Array(PostTagAssignment),
    error: Schema.Union([TagServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("ChangelogTagList", {
    payload: ChangelogTagList,
    success: Schema.Array(ChangelogTagAssignment),
    error: TagServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ChangelogTagListPublic", {
    payload: ChangelogTagList,
    success: Schema.Array(ChangelogTagAssignment),
    error: Schema.Union([TagServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("PostTagSet", {
    payload: PostTagSet,
    success: Schema.Void,
    error: TagServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ChangelogTagSet", {
    payload: ChangelogTagSet,
    success: Schema.Void,
    error: TagServiceErrors,
  }).middleware(AuthMiddleware)
) {}
