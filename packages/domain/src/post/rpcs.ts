import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware, OptionalAuthMiddleware } from "../session-middleware";
import { PostServiceErrors } from "./errors";
import {
  Post,
  PostAdminUpdate,
  PostCreate,
  PostDelete,
  PostDeletePublic,
  PostGet,
  PostList,
  PostMerge,
  PostOfficialUpdatePublish,
  PostSuggestions,
  PostUpdate,
  PostUpdateContent,
  PostUpdateEta,
  PostUpdateTitle,
} from "./schema";

export class PostRpcs extends RpcGroup.make(
  // Naming note: `*Public` here means "public portal" (widget/feedback board),
  // NOT anonymous. Every `*Public` RPC below still requires AuthMiddleware
  // (or OptionalAuthMiddleware for reads) plus PublicRpcRateLimitMiddleware.
  // Removing AuthMiddleware would make portal posts writable by unauthenticated
  // callers — do not do that without adding an explicit anonymous-identity path.
  Rpc.make("PostList", {
    payload: PostList,
    success: Schema.Array(Post),
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PostListPublic", {
    payload: PostList,
    success: Schema.Array(Post),
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("PostGetPublic", {
    payload: PostGet,
    success: Post,
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("PostSuggestions", {
    payload: PostSuggestions,
    success: Schema.Array(Post),
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PostSuggestionsPublic", {
    payload: PostSuggestions,
    success: Schema.Array(Post),
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("PostCreate", {
    // Returns the slug the insert actually persisted (including any
    // collision suffix) so callers can reference the stored post.
    success: Schema.String,
    payload: PostCreate,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PostCreatePublic", {
    // Returns the slug the insert actually persisted (including any
    // collision suffix) so callers can reference the stored post.
    success: Schema.String,
    payload: PostCreate,
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("PostDelete", {
    success: Schema.Void,
    payload: PostDelete,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PostDeletePublic", {
    success: Schema.Void,
    payload: PostDeletePublic,
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("PostUpdate", {
    success: Schema.Void,
    payload: PostUpdate,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PostUpdateEta", {
    success: Schema.Void,
    payload: PostUpdateEta,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PostUpdatePublic", {
    success: Schema.Void,
    payload: PostUpdate,
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("PostUpdateContent", {
    success: Schema.Void,
    payload: PostUpdateContent,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PostUpdateTitle", {
    success: Schema.Void,
    payload: PostUpdateTitle,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PostUpdateContentPublic", {
    success: Schema.Void,
    payload: PostUpdateContent,
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("PostUpdateTitlePublic", {
    success: Schema.Void,
    payload: PostUpdateTitle,
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("PostAdminUpdate", {
    success: Schema.Void,
    payload: PostAdminUpdate,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PostMerge", {
    success: Schema.Void,
    payload: PostMerge,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PostOfficialUpdatePublish", {
    success: Schema.Void,
    payload: PostOfficialUpdatePublish,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware)
) {}
