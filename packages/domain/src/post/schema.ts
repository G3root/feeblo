import {
  BoardId,
  PostActivityId,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import * as S from "effect/Schema";

import {
  POST_CONTENT_MAX_LENGTH,
  POST_OFFICIAL_UPDATE_BODY_MAX_LENGTH,
  POST_SUGGESTIONS_LIMIT_MAX,
  POST_SUGGESTIONS_LIMIT_MIN,
  POST_TITLE_MAX_LENGTH,
  POST_TITLE_MIN_LENGTH,
} from "../content-limits";

export const EtaQuarter = S.String.pipe(
  S.check(S.isPattern(/^[0-9]{4}-Q[1-4]$/))
);

export const Post = S.Struct({
  assetIds: S.optional(S.Array(S.String)),
  id: S.String,
  boardId: S.String,
  title: S.String,
  slug: S.String,
  content: S.String,
  excerpt: S.String,
  statusId: S.String,
  etaQuarter: S.NullOr(EtaQuarter),
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
  organizationId: S.String,
  creatorMemberId: S.NullOr(S.String),
  creatorId: S.NullOr(S.String),
  /** UI hint; the backend remains authoritative for deletion. */
  canDeleteAsCreator: S.optional(S.Boolean),
  lockedAt: S.NullOr(S.DateFromString),
  archivedAt: S.NullOr(S.DateFromString),
  mergedIntoPostId: S.NullOr(S.String),
  mergedAt: S.NullOr(S.DateFromString),
  user: S.Struct({
    name: S.NullOr(S.String),
    image: S.NullOr(S.String),
  }),
});

export type TPost = S.Schema.Type<typeof Post>;

export const PostList = S.Struct({
  boardId: S.Union([S.String, S.Null, S.Undefined]),
  organizationId: S.String,
});

export type TPostList = S.Schema.Type<typeof PostList>;

export const PostGet = S.Struct({
  organizationId: S.String,
  slug: S.String,
});

export type TPostGet = S.Schema.Type<typeof PostGet>;

export const PostSuggestions = S.Struct({
  boardId: S.optional(BoardId.schema),
  content: S.String,
  limit: S.optional(
    S.Int.check(
      S.isBetween({
        minimum: POST_SUGGESTIONS_LIMIT_MIN,
        maximum: POST_SUGGESTIONS_LIMIT_MAX,
      })
    )
  ),
  organizationId: WorkspaceId.schema,
  title: S.String,
});

export type TPostSuggestions = S.Schema.Type<typeof PostSuggestions>;

export const PostIds = S.Array(S.String);

export const PostDelete = S.Struct({
  id: S.Union([PostId.schema, S.Array(PostId.schema)]),
  boardId: BoardId.schema,
  organizationId: WorkspaceId.schema,
});

export const PostDeletePublic = S.Struct({
  id: PostId.schema,
  boardId: BoardId.schema,
  organizationId: WorkspaceId.schema,
});

export type TPostDelete = S.Schema.Type<typeof PostDelete>;

export type TPostDeletePublic = S.Schema.Type<typeof PostDeletePublic>;

export const PostUpdate = S.Struct({
  id: PostId.schema,
  statusId: PostStatusId.schema,
  boardId: BoardId.schema,
  organizationId: WorkspaceId.schema,
});

export type TPostUpdate = S.Schema.Type<typeof PostUpdate>;

export const PostUpdateEta = S.Struct({
  id: PostId.schema,
  organizationId: WorkspaceId.schema,
  etaQuarter: S.NullOr(EtaQuarter),
});

export type TPostUpdateEta = S.Schema.Type<typeof PostUpdateEta>;

export const PostUpdateContent = S.Struct({
  assetIds: S.Array(S.String),
  id: PostId.schema,
  content: S.String.check(S.isMaxLength(POST_CONTENT_MAX_LENGTH)),
  boardId: BoardId.schema,
  organizationId: WorkspaceId.schema,
});

export type TPostUpdateContent = S.Schema.Type<typeof PostUpdateContent>;

export const PostTitle = S.Trim.pipe(
  S.check(S.isMinLength(POST_TITLE_MIN_LENGTH)),
  S.check(S.isMaxLength(POST_TITLE_MAX_LENGTH))
);

export const PostUpdateTitle = S.Struct({
  id: PostId.schema,
  title: PostTitle,
  boardId: BoardId.schema,
  organizationId: WorkspaceId.schema,
});

export type TPostUpdateTitle = S.Schema.Type<typeof PostUpdateTitle>;

export const PostAdminUpdate = S.Struct({
  id: PostId.schema,
  organizationId: WorkspaceId.schema,
  archived: S.optional(S.Boolean),
  locked: S.optional(S.Boolean),
});

export type TPostAdminUpdate = S.Schema.Type<typeof PostAdminUpdate>;

/** Administrator-authored update that is intentionally emailed to post subscribers. */
export const PostOfficialUpdatePublish = S.Struct({
  body: S.String.pipe(
    S.check(S.isMinLength(1)),
    S.check(S.isMaxLength(POST_OFFICIAL_UPDATE_BODY_MAX_LENGTH))
  ),
  organizationId: WorkspaceId.schema,
  postId: PostId.schema,
  updateId: PostActivityId.schema,
});

export type TPostOfficialUpdatePublish = S.Schema.Type<
  typeof PostOfficialUpdatePublish
>;

export const PostMerge = S.Struct({
  organizationId: WorkspaceId.schema,
  sourcePostId: PostId.schema,
  targetPostId: PostId.schema,
});

export type TPostMerge = S.Schema.Type<typeof PostMerge>;

/**
 * Minimal deliverability shape for author input: `local@domain.tld`, no
 * whitespace. Synthetic inboxes are generated internally and never pass
 * through this input; without the shape check, a direct RPC caller could
 * persist junk contact emails that can never heal or receive notifications.
 */
const AuthorEmail = S.String.check(
  S.makeFilter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), {
    message: "author.email must be a valid email address",
  })
);

/**
 * The customer a dashboard post is attributed to when created on behalf of
 * them (see plan-on-behalf.md). Identifiers are consulted in strict priority
 * order by `ResolvePrincipalService`: `userId` > `contactId` > `externalId` >
 * `email`; `name`/`avatarUrl` only enrich the resolved contact.
 */
export const PostCreateAuthor = S.Struct({
  userId: S.optional(S.String),
  contactId: S.optional(S.String),
  externalId: S.optional(S.String),
  email: S.optional(AuthorEmail),
  name: S.optional(S.String),
  avatarUrl: S.optional(S.String),
});

export type TPostCreateAuthor = S.Schema.Type<typeof PostCreateAuthor>;

export const PostCreate = S.Struct({
  assetIds: S.Array(S.String),
  id: PostId.schema,
  boardId: BoardId.schema,
  // Same shape as PostUpdateTitle.title: trimmed, non-empty, and bounded so a
  // created post can never carry a whitespace/empty title that the update
  // path (or slug/excerpt derivation) would reject or render invisibly.
  title: PostTitle,
  // Content is sanitized and then stored, embedded, emailed and webhook-
  // delivered; cap it so a single post cannot carry unbounded payloads.
  content: S.String.check(S.isMaxLength(POST_CONTENT_MAX_LENGTH)),
  statusId: PostStatusId.schema,
  organizationId: WorkspaceId.schema,
  etaQuarter: S.optional(S.NullOr(EtaQuarter)),
  /** Present ⇒ the post is created on behalf of the resolved customer. */
  author: S.optional(PostCreateAuthor),
});

export type TPostCreate = S.Schema.Type<typeof PostCreate>;
