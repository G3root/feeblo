import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware, OptionalAuthMiddleware } from "../session-middleware";
import { PostServiceErrors } from "./errors";
import {
  Post,
  PostAdminUpdate,
  PostCreate,
  PostDelete,
  PostDeleteEligibilityList,
  PostDeleteEligibilityListPublic,
  PostDeleteEligibilityListResult,
  PostDeletePublic,
  PostGet,
  PostList,
  PostListItem,
  PostMerge,
  PostOfficialUpdatePublish,
  PostSuggestions,
  PostUnmerge,
  PostUpdate,
  PostUpdateAuthor,
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
  Rpc.make("ListPosts", {
    payload: PostList,
    success: Schema.Array(PostListItem),
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ListPostsPublic", {
    payload: PostList,
    success: Schema.Array(PostListItem),
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  // Authenticated detail fetch (full `Post` including `content`) for the
  // dashboard. Lists return the slim `PostListItem`; detail routes resolve
  // the body through this RPC instead of over-fetching it for every row.
  Rpc.make("GetPost", {
    payload: PostGet,
    success: Post,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("GetPostPublic", {
    payload: PostGet,
    success: Post,
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  // Resolves a merged source slug to its surviving target slug so public
  // detail routes can 301 redirect instead of 404ing. Returns null when the
  // source is not a publicly visible merged post.
  Rpc.make("ResolveMergedPostPublic", {
    payload: PostGet,
    success: Schema.NullOr(Schema.String),
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("GetPostSuggestions", {
    payload: PostSuggestions,
    success: Schema.Array(Post),
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("GetPostSuggestionsPublic", {
    payload: PostSuggestions,
    success: Schema.Array(Post),
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("CreatePost", {
    // Returns the slug the insert actually persisted (including any
    // collision suffix) so callers can reference the stored post.
    success: Schema.String,
    payload: PostCreate,
    // On-behalf creates consume the per-member dashboard rate limit.
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  }).middleware(AuthMiddleware),

  Rpc.make("CreatePostPublic", {
    // Returns the slug the insert actually persisted (including any
    // collision suffix) so callers can reference the stored post.
    success: Schema.String,
    payload: PostCreate,
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("DeletePost", {
    success: Schema.Void,
    payload: PostDelete,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("DeletePostPublic", {
    success: Schema.Void,
    payload: PostDeletePublic,
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  // Delete affordance sync (see `ListPostDeleteEligibility` schema): the
  // caller's whole eligible set in one lookup, overfetched client-side,
  // instead of per-row probes on every list fetch.
  Rpc.make("ListPostDeleteEligibility", {
    success: PostDeleteEligibilityListResult,
    payload: PostDeleteEligibilityList,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ListPostDeleteEligibilityPublic", {
    success: PostDeleteEligibilityListResult,
    payload: PostDeleteEligibilityListPublic,
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("UpdatePost", {
    success: Schema.Void,
    payload: PostUpdate,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("UpdatePostEta", {
    success: Schema.Void,
    payload: PostUpdateEta,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("UpdatePostAuthor", {
    success: Schema.Void,
    payload: PostUpdateAuthor,
    // Reassignment shares the on-behalf write rate limit with creation.
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  }).middleware(AuthMiddleware),

  Rpc.make("UpdatePostPublic", {
    success: Schema.Void,
    payload: PostUpdate,
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("UpdatePostContent", {
    success: Schema.Void,
    payload: PostUpdateContent,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("UpdatePostTitle", {
    success: Schema.Void,
    payload: PostUpdateTitle,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("UpdatePostContentPublic", {
    success: Schema.Void,
    payload: PostUpdateContent,
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("UpdatePostTitlePublic", {
    success: Schema.Void,
    payload: PostUpdateTitle,
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("AdminUpdatePost", {
    success: Schema.Void,
    payload: PostAdminUpdate,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("MergePost", {
    success: Schema.Void,
    payload: PostMerge,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("UnmergePost", {
    success: Schema.Void,
    payload: PostUnmerge,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PublishPostOfficialUpdate", {
    success: Schema.Void,
    payload: PostOfficialUpdatePublish,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware)
) {}
