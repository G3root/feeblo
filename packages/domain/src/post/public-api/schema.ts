import { PostActivityKind } from "@feeblo/domain-contracts/activity-kind";
import { PostStatusType } from "@feeblo/domain-contracts/post-status-type";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import {
  POST_CONTENT_MAX_LENGTH,
  POST_TITLE_MAX_LENGTH,
} from "../../content-limits";
import { PUBLIC_API_PAGE_MAX_LIMIT } from "../../public-api/common";
import {
  PublicApiAuthor,
  PublicApiOnBehalfAuthor,
  PublicApiTag,
} from "../../public-api/common";
import { paramsOf, payloadOf } from "../../public-api/http-input";
import { isIsoDateOrTimestamp } from "../../public-api/parse";

/**
 * The post resource: what the post endpoints return, and the typed input every
 * post operation takes.
 *
 * The `*Input` schemas are what an operation receives — typed values, so a
 * surface that already has types (MCP, a CLI) has nothing to parse — and they
 * are the authority for the constraints a request obeys. A `*Payload` and a
 * `*Params` are the HTTP body and path projected from that input; the `*Query`
 * schemas describe the URL's filters, where parameters are strings validated
 * in the endpoint's handler so a malformed request stays on the published
 * error envelope.
 */

export const PublicApiPostStatus = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: PostStatusType,
});

const ETA_QUARTER_PATTERN = /^[0-9]{4}-Q[1-4]$/;

/**
 * A raw date string that names a real instant.
 *
 * `Schema.DateFromString` alone is too permissive: it accepts host formats
 * like `August 11, 2026` and rolls a day that does not exist (`2026-02-30`)
 * over into the next month. The shape and calendar checks are the same ones
 * the post list's `updatedAfter` filter uses, so the two date parameters
 * cannot disagree about which strings are real dates.
 */
const IsoInstant = Schema.String.check(
  Schema.makeFilter(isIsoDateOrTimestamp, {
    message: "must be an ISO 8601 date or timestamp naming a real date",
  })
).pipe(Schema.decodeTo(Schema.Date, SchemaTransformation.dateFromString));

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

/** The post the URL names, taken from the operation input. */
export const ListPostActivityParams = paramsOf(ListPostActivityInput, [
  "postId",
]);

/**
 * Query parameters are declared as strings and validated in the handler.
 *
 * A typed parameter would make the framework reject a malformed request with
 * its own error body, which is not this API's documented envelope; validating
 * here keeps every failure on the published vocabulary (`INVALID_REQUEST`).
 */
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

/**
 * A post title, trimmed before its length is measured.
 *
 * The dashboard's own title schema trims first for the same reason: padding a
 * title must not count against the caller, and `"  Dark mode  "` is the title
 * `"Dark mode"` everywhere it is stored and slugified.
 *
 * Emptiness is deliberately not checked here. The handler reports it
 * (`parseTitle`) so the answer names the field — the same split the tag and
 * changelog inputs use for a required name, whose schemas carry no minimum
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
 * than restated so the two cannot disagree about how long a post may be. The
 * constraints sit on this input, which the operation receives, so the HTTP
 * body and the MCP tool validate against the same title and body lengths.
 *
 * `author` is optional and names the customer the post is attributed to, with
 * the same identifiers and priority order a comment's author uses. Absent, the
 * post has no author: a machine key is not a member and has no identity to
 * invent. `createdAt` is optional and backdates the post for an import; the
 * list orders by it, while `updatedAt` stays the write's clock so a sync
 * reading `updatedAfter` still sees the imported row.
 */
export const CreatePostInput = Schema.Struct({
  boardId: Schema.String,
  title: PostTitle,
  content: Schema.String.check(Schema.isMaxLength(POST_CONTENT_MAX_LENGTH)),
  statusId: Schema.String,
  etaQuarter: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isPattern(ETA_QUARTER_PATTERN)))
  ),
  author: Schema.optional(PublicApiOnBehalfAuthor),
  createdAt: Schema.optional(IsoInstant),
});

/**
 * The create body: the operation input with no path field to remove.
 *
 * Derived rather than restated, so a field the operation accepts is a field
 * the HTTP body accepts — with the same constraints the MCP tool advertises —
 * and a new field cannot be published on one surface and dropped by the
 * other.
 */
export const CreatePostPayload = payloadOf(CreatePostInput, []);

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
export const UpdatePostInput = Schema.Struct({
  postId: Schema.String,
  title: Schema.optional(PostTitle),
  content: Schema.optional(
    Schema.String.check(Schema.isMaxLength(POST_CONTENT_MAX_LENGTH))
  ),
  statusId: Schema.optional(Schema.String),
  boardId: Schema.optional(Schema.String),
  etaQuarter: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isPattern(ETA_QUARTER_PATTERN)))
  ),
  author: Schema.optional(PublicApiOnBehalfAuthor),
});

/** The post the URL names, taken from the operation input. */
export const UpdatePostParams = paramsOf(UpdatePostInput, ["postId"]);

/** The update body: the operation input without the post the URL names. */
export const UpdatePostPayload = payloadOf(UpdatePostInput, ["postId"]);

export type TUpdatePostPayload = Schema.Schema.Type<typeof UpdatePostPayload>;

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
  tagIds: Schema.optional(Schema.NonEmptyArray(Schema.String)).annotate({
    description:
      "Keep posts carrying at least one of these tag ids; at least one id is required",
  }),
  // A string rather than a `Schema.DateFromString`: the operation validates
  // the ISO shape and the calendar itself, so the HTTP query parameter and the
  // MCP tool argument are checked by the same code and an MCP caller cannot
  // send a day that does not exist while an HTTP caller cannot.
  updatedAfter: Schema.optional(Schema.String).annotate({
    description: "Keep posts changed after this ISO 8601 instant",
  }),
});

/** The board the URL names, taken from the operation input. */
export const ListBoardPostsParams = paramsOf(ListBoardPostsInput, ["boardId"]);

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
  tagIds: Schema.optional(Schema.NonEmptyArray(Schema.String)).annotate({
    description:
      "Keep posts carrying at least one of these tag ids; at least one id is required",
  }),
  updatedAfter: Schema.optional(Schema.String).annotate({
    description: "Keep posts changed after this ISO 8601 instant",
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

/** The post the URL names, taken from the operation input. */
export const GetPostParams = paramsOf(GetPostInput, ["postId"]);

/** Typed input for deleting a post. */
export const DeletePostInput = Schema.Struct({
  postId: Schema.String,
});

/** The post the URL names, taken from the operation input. */
export const DeletePostParams = paramsOf(DeletePostInput, ["postId"]);

/** Typed input for merging one post into another. */
export const MergePostInput = Schema.Struct({
  postId: Schema.String,
  intoPostId: Schema.String,
});

/** The post the URL names, taken from the operation input. */
export const MergePostParams = paramsOf(MergePostInput, ["postId"]);

/**
 * The post the archived duplicate is folded into.
 *
 * The source is the path's `postId`, so the body names only the survivor: a
 * merge is "this post into that one", and repeating the source in the body
 * would give two places to disagree about which post is being archived.
 */
export const MergePostPayload = payloadOf(MergePostInput, ["postId"]);

export type TMergePostInput = Schema.Schema.Type<typeof MergePostInput>;

/** Typed input for reverting a merge. */
export const UnmergePostInput = Schema.Struct({
  postId: Schema.String,
});

/** The post the URL names, taken from the operation input. */
export const UnmergePostParams = paramsOf(UnmergePostInput, ["postId"]);

export type TUnmergePostInput = Schema.Schema.Type<typeof UnmergePostInput>;

/** Typed input for replacing the tags a post carries. */
export const SetPostTagsInput = Schema.Struct({
  postId: Schema.String,
  tagIds: Schema.Array(Schema.String).annotate({
    description: "The complete set of tag ids the post should carry",
  }),
});

/** The post the URL names, taken from the operation input. */
export const SetPostTagsParams = paramsOf(SetPostTagsInput, ["postId"]);

/**
 * The complete set of tags a post should carry.
 *
 * A replacement rather than add and remove calls: the dashboard's own tag
 * picker works this way, and a caller that states the final set cannot leave a
 * tag behind by forgetting to remove it. An empty array clears the post.
 */
export const SetPostTagsPayload = payloadOf(SetPostTagsInput, ["postId"]);

export type TSetPostTagsPayload = Schema.Schema.Type<typeof SetPostTagsPayload>;
