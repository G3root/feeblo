import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware, OptionalAuthMiddleware } from "../session-middleware";
import { TagServiceErrors } from "./errors";
import {
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
  Rpc.make("ListTags", {
    payload: TagList,
    success: Schema.Array(Tag),
    error: TagServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ListTagsPublic", {
    payload: TagList,
    success: Schema.Array(Tag),
    error: Schema.Union([TagServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("CreateTag", {
    payload: TagCreate,
    success: Schema.Void,
    error: TagServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("UpdateTag", {
    payload: TagUpdate,
    success: Schema.Void,
    error: TagServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("DeleteTag", {
    payload: TagDelete,
    success: Schema.Void,
    error: TagServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ListPostTags", {
    payload: PostTagList,
    success: Schema.Array(PostTagAssignment),
    error: TagServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ListPostTagsPublic", {
    payload: PostTagList,
    success: Schema.Array(PostTagAssignment),
    error: Schema.Union([TagServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("SetPostTags", {
    payload: PostTagSet,
    success: Schema.Void,
    error: TagServiceErrors,
  }).middleware(AuthMiddleware)
) {}
