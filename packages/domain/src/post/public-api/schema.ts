import { PostActivityKind } from "@feeblo/domain-contracts/activity-kind";
import { PostStatusType } from "@feeblo/domain-contracts/post-status-type";
import * as Schema from "effect/Schema";

import {
  POST_CONTENT_MAX_LENGTH,
  POST_TITLE_MAX_LENGTH,
} from "../../content-limits";
import { PUBLIC_API_PAGE_MAX_LIMIT } from "../../public-api/common";
import { PublicApiAuthor, PublicApiTag } from "../../public-api/common";

/**
 * The post resource: what the post endpoints return, and the typed input every
 * post operation takes.
 *
 * The `*Query`/`*Params`/`*Payload` schemas describe the HTTP projection:
 * query parameters are strings validated in the endpoint's handler so a
 * malformed request stays on the published error envelope. The `*Input`
 * schemas are what an operation actually receives — typed values, so a surface
 * that already has types (MCP, a CLI) has nothing to parse.
 */

export const PublicApiPostStatus = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: PostStatusType,
});

const ETA_QUARTER_PATTERN = /^[0-9]{4}-Q[1-4]$/;

/** List projection: everything except the post body. */
export const PublicApiPostSummary = Schema.Struct({
  id: Schema.String,
  boardId: Schema.String,
  title: Schema.String,
  slug: Schema.String,
  excerpt: Schema.String,
  url: Schema.String,
  status: PublicApiPostStatus,
  etaQuarter: Schema.NullOr(
    Schema.String.check(Schema.isPattern(ETA_QUARTER_PATTERN))
  ),
  tags: Schema.Array(PublicApiTag),
  voteCount: Schema.Finite,
  commentCount: Schema.Finite,
  author: PublicApiAuthor,
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString,
  lockedAt: Schema.NullOr(Schema.DateFromString),
  archivedAt: Schema.NullOr(Schema.DateFromString),
  mergedIntoPostId: Schema.NullOr(Schema.String),
});

export type TPublicApiPostSummary = Schema.Schema.Type<
  typeof PublicApiPostSummary
>;

/** Detail projection: the summary plus the sanitized body. */
export const PublicApiPost = Schema.Struct({
  ...PublicApiPostSummary.fields,
  content: Schema.String,
});

export type TPublicApiPost = Schema.Schema.Type<typeof PublicApiPost>;

export const PublicApiPostPage = Schema.Struct({
  data: Schema.Array(PublicApiPostSummary),
  nextCursor: Schema.NullOr(Schema.String),
});

export type TPublicApiPostPage = Schema.Schema.Type<typeof PublicApiPostPage>;

/**
 * The tags a post carries after a write.
 *
 * The embedded tag shape, not the tag resource: these are references to tags,
 * and a caller that wants a slug or a timestamp reads the tag itself.
 */
export const PublicApiPostTags = Schema.Struct({
  data: Schema.Array(PublicApiTag),
});

export type TPublicApiPostTags = Schema.Schema.Type<typeof PublicApiPostTags>;

/**
 * One entry of a post's timeline.
 *
 * The timeline is the post's own history — created, status changed, tags
 * added, merged — so an integration can tell what happened to a post without
 * diffing snapshots. `previousValue` and `nextValue` are the values the entry
 * moved between, and what they name depends on `kind`: a status id for
 * `STATUS_CHANGED`, a tag id for `TAG_ADDED`, a post id for `POST_MERGED`.
 *
 * `actor` is `null` when a machine key wrote the entry, because an API key is
 * not a member and has no identity to attribute; the alternative would be to
 * invent one. The entry's internal identifiers — the actor's user and member
 * ids, and the on-behalf metadata — are not part of the payload
 * (see `docs/adr/0004`).
 */
export const PublicApiPostActivity = Schema.Struct({
  id: Schema.String,
  kind: PostActivityKind,
  actor: Schema.NullOr(PublicApiAuthor),
  previousValue: Schema.NullOr(Schema.String),
  nextValue: Schema.NullOr(Schema.String),
  commentId: Schema.NullOr(Schema.String),
  createdAt: Schema.DateFromString,
});

export type TPublicApiPostActivity = Schema.Schema.Type<
  typeof PublicApiPostActivity
>;

export const PublicApiPostActivityPage = Schema.Struct({
  data: Schema.Array(PublicApiPostActivity),
  nextCursor: Schema.NullOr(Schema.String),
});

export type TPublicApiPostActivityPage = Schema.Schema.Type<
  typeof PublicApiPostActivityPage
>;

export const ListPostActivityParams = Schema.Struct({
  postId: Schema.String,
});

export const ListPostActivityQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
});

/** Typed input for a page of a post's timeline. */
export const ListPostActivityInput = Schema.Struct({
  postId: Schema.String,
  cursor: Schema.optional(
    Schema.String.annotate({ description: "Opaque page cursor" })
  ),
  limit: Schema.optional(
    Schema.Finite.check(
      Schema.isInt(),
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(PUBLIC_API_PAGE_MAX_LIMIT)
    ).annotate({
      description: "Page size, 1–100",
    })
  ),
});

export type TListPostActivityInput = Schema.Schema.Type<
  typeof ListPostActivityInput
>;

/**
 * Query parameters are declared as strings and validated in the handler.
 *
 * A typed parameter would make the framework reject a malformed request with
 * its own error body, which is not this API's documented envelope; validating
 * here keeps every failure on the published vocabulary (`INVALID_REQUEST`).
 */
export const ListBoardPostsParams = Schema.Struct({
  boardId: Schema.String,
});

export const ListBoardPostsQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  includeArchived: Schema.optional(Schema.String),
  tagIds: Schema.optional(Schema.String),
  updatedAfter: Schema.optional(Schema.String),
});

/**
 * The same paging and filtering rules as a board's list, without the board.
 *
 * Declared separately rather than reusing `ListBoardPostsQuery` so the two can
 * move apart later without a rename: this one answers "what happened in the
 * workspace", and a caller reading the document should see each endpoint's
 * parameters written where the endpoint is.
 */
export const ListPostsQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  includeArchived: Schema.optional(Schema.String),
  boardId: Schema.optional(Schema.String),
  tagIds: Schema.optional(Schema.String),
  updatedAfter: Schema.optional(Schema.String),
});

/**
 * How a caller names the post it wants.
 *
 * All three are optional because a caller may know the post's id, or only the
 * board and the slug that appear in its public URL. The pairing rule is the
 * handler's: a slug is only meaningful next to a board, so a request that
 * carries one without `boardId` is rejected rather than matched against every
 * board in the workspace.
 */
export const RetrievePostQuery = Schema.Struct({
  id: Schema.optional(Schema.String),
  boardId: Schema.optional(Schema.String),
  slug: Schema.optional(Schema.String),
});

export const GetPostParams = Schema.Struct({
  postId: Schema.String,
});

export const UpdatePostParams = Schema.Struct({
  postId: Schema.String,
});

export const DeletePostParams = Schema.Struct({
  postId: Schema.String,
});

export const SetPostTagsParams = Schema.Struct({
  postId: Schema.String,
});

/**
 * A post title, trimmed before its length is measured.
 *
 * The dashboard's own title schema trims first for the same reason: padding a
 * title must not count against the caller, and `"  Dark mode  "` is the title
 * `"Dark mode"` everywhere it is stored and slugified.
 *
 * Emptiness is deliberately not checked here. The handler reports it
 * (`parseTitle`) so the answer names the field — the same split the tag and
 * changelog payloads use for a required name, whose schemas carry no minimum
 * either. Nothing between the two can be written: a title the schema accepts
 * is trimmed, and the handler refuses it when nothing is left.
 */
const PostTitle = Schema.Trim.pipe(
  Schema.check(Schema.isMaxLength(POST_TITLE_MAX_LENGTH))
);

/**
 * The writable fields of a post, as a create states them.
 *
 * `id` is assigned by the server rather than chosen by the caller, for the
 * same reason a tag's is: a machine key is not a member acting on records it
 * can already see, and a caller-chosen primary key would make the id part of
 * the request surface.
 *
 * `statusId` is required because a post has no default status: the workspace
 * defines its own. It is the id the post endpoints already return inside a
 * post's `status`, so a caller that can read a post can name one.
 *
 * The title is trimmed and the body sanitized before they are stored, exactly
 * as the dashboard does; the limits are the dashboard's own, imported rather
 * than restated so the two cannot disagree about how long a post may be.
 */
export const CreatePostPayload = Schema.Struct({
  boardId: Schema.String,
  title: PostTitle,
  content: Schema.String.check(Schema.isMaxLength(POST_CONTENT_MAX_LENGTH)),
  statusId: Schema.String,
  etaQuarter: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isPattern(ETA_QUARTER_PATTERN)))
  ),
});

export type TCreatePostPayload = Schema.Schema.Type<typeof CreatePostPayload>;

/**
 * A partial update: an absent field is left alone, `null` clears a nullable
 * one.
 *
 * `statusId` and `boardId` are writable here because an integration that syncs
 * a tracker has to move a post as its state changes; a key that may edit a post
 * may move it. A body that names no field at all is rejected in the handler
 * rather than answered as a write that changed only `updatedAt`.
 */
export const UpdatePostPayload = Schema.Struct({
  title: Schema.optional(PostTitle),
  content: Schema.optional(
    Schema.String.check(Schema.isMaxLength(POST_CONTENT_MAX_LENGTH))
  ),
  statusId: Schema.optional(Schema.String),
  boardId: Schema.optional(Schema.String),
  etaQuarter: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isPattern(ETA_QUARTER_PATTERN)))
  ),
});

export type TUpdatePostPayload = Schema.Schema.Type<typeof UpdatePostPayload>;

/**
 * The complete set of tags a post should carry.
 *
 * A replacement rather than add and remove calls: the dashboard's own tag
 * picker works this way, and a caller that states the final set cannot leave a
 * tag behind by forgetting to remove it. An empty array clears the post.
 */
export const SetPostTagsPayload = Schema.Struct({
  tagIds: Schema.Array(Schema.String),
});

export type TSetPostTagsPayload = Schema.Schema.Type<typeof SetPostTagsPayload>;

/** Typed input for a page of a board's posts. */
export const ListBoardPostsInput = Schema.Struct({
  boardId: Schema.String,
  cursor: Schema.optional(
    Schema.String.annotate({ description: "Opaque page cursor" })
  ),
  includeArchived: Schema.optional(Schema.Boolean),
  limit: Schema.optional(
    Schema.Finite.check(
      Schema.isInt(),
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(PUBLIC_API_PAGE_MAX_LIMIT)
    ).annotate({
      description: "Page size, 1–100",
    })
  ),
  statusId: Schema.optional(Schema.NullOr(Schema.String)),
  tagIds: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Keep posts carrying at least one of these tag ids",
  }),
  updatedAfter: Schema.optional(Schema.DateFromString).annotate({
    description: "Keep posts changed after this instant",
  }),
});

/** Typed input for a page of the workspace's posts. */
export const ListPostsInput = Schema.Struct({
  boardId: Schema.optional(Schema.String),
  cursor: Schema.optional(
    Schema.String.annotate({ description: "Opaque page cursor" })
  ),
  includeArchived: Schema.optional(Schema.Boolean),
  limit: Schema.optional(
    Schema.Finite.check(
      Schema.isInt(),
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(PUBLIC_API_PAGE_MAX_LIMIT)
    ).annotate({
      description: "Page size, 1–100",
    })
  ),
  statusId: Schema.optional(Schema.NullOr(Schema.String)),
  tagIds: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Keep posts carrying at least one of these tag ids",
  }),
  updatedAfter: Schema.optional(Schema.DateFromString).annotate({
    description: "Keep posts changed after this instant",
  }),
});

/** Typed input for finding a post by id, or by board and slug. */
export const RetrievePostInput = Schema.Struct({
  boardId: Schema.optional(Schema.String),
  postId: Schema.optional(Schema.String),
  slug: Schema.optional(Schema.String),
});

/** Typed input for reading one post by id. */
export const GetPostInput = Schema.Struct({
  postId: Schema.String,
});

/** Typed input for creating a post. */
export const CreatePostInput = Schema.Struct({
  boardId: Schema.String,
  content: Schema.String.check(Schema.isMaxLength(POST_CONTENT_MAX_LENGTH)),
  etaQuarter: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isPattern(ETA_QUARTER_PATTERN)))
  ),
  statusId: Schema.String,
  title: Schema.String,
});

/** Typed input for updating a post. */
export const UpdatePostInput = Schema.Struct({
  postId: Schema.String,
  title: Schema.optional(Schema.String),
  content: Schema.optional(
    Schema.String.check(Schema.isMaxLength(POST_CONTENT_MAX_LENGTH))
  ),
  statusId: Schema.optional(Schema.String),
  boardId: Schema.optional(Schema.String),
  etaQuarter: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isPattern(ETA_QUARTER_PATTERN)))
  ),
});

/** Typed input for deleting a post. */
export const DeletePostInput = Schema.Struct({
  postId: Schema.String,
});

/** Typed input for replacing the tags a post carries. */
export const SetPostTagsInput = Schema.Struct({
  postId: Schema.String,
  tagIds: Schema.Array(Schema.String).annotate({
    description: "The complete set of tag ids the post should carry",
  }),
});
