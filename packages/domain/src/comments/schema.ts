import { CommentId, PostId, PostStatusId, WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

import { COMMENT_CONTENT_MAX_LENGTH } from "../content-limits";

export const Comment = S.Struct({
  id: S.String,
  content: S.String,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
  organizationId: S.String,
  postId: S.String,
  /** Denormalized post slug; unique per organization (post_organizationId_slug_uidx). */
  postSlug: S.String,
  /** Null on public endpoints for commenters other than the session user. */
  userId: S.NullOr(S.String),
  visibility: S.Literals(["PUBLIC", "INTERNAL"]),
  parentCommentId: S.Union([S.String, S.Null]),
  memberId: S.Union([S.String, S.Null]),
  /** Post status (org-scoped FK) this comment moved the post to, when posted as a status update. */
  statusUpdateId: S.NullOr(S.String),
  pinnedAt: S.NullOr(S.DateFromString),
  user: S.Struct({
    name: S.String,
  }),
});

export type TComment = S.Schema.Type<typeof Comment>;

export const CommentList = S.Struct({
  organizationId: S.String,
  slug: S.String,
});

export type TCommentList = S.Schema.Type<typeof CommentList>;

export const CommentCreate = S.Struct({
  id: CommentId.schema,
  organizationId: WorkspaceId.schema,
  postId: PostId.schema,
  content: S.String.check(S.isMaxLength(COMMENT_CONTENT_MAX_LENGTH)),
  visibility: S.Literals(["PUBLIC", "INTERNAL"]),
  parentCommentId: S.Union([CommentId.schema, S.Null]),
  /** Optional post status (org-scoped FK) this comment moves the post to. */
  statusUpdateId: S.optional(S.NullOr(PostStatusId.schema)),
});

export type TCommentCreate = S.Schema.Type<typeof CommentCreate>;

export const CommentDelete = S.Struct({
  id: CommentId.schema,
  organizationId: WorkspaceId.schema,
  postId: PostId.schema,
});

export type TCommentDelete = S.Schema.Type<typeof CommentDelete>;

export const CommentUpdate = S.Struct({
  id: CommentId.schema,
  organizationId: WorkspaceId.schema,
  postId: PostId.schema,
  content: S.String.check(S.isMaxLength(COMMENT_CONTENT_MAX_LENGTH)),
  visibility: S.Literals(["PUBLIC", "INTERNAL"]),
});

export type TCommentUpdate = S.Schema.Type<typeof CommentUpdate>;

export const CommentPin = S.Struct({
  id: CommentId.schema,
  organizationId: WorkspaceId.schema,
  postId: PostId.schema,
});

export type TCommentPin = S.Schema.Type<typeof CommentPin>;

export const CommentUnpin = S.Struct({
  id: CommentId.schema,
  organizationId: WorkspaceId.schema,
  postId: PostId.schema,
});

export type TCommentUnpin = S.Schema.Type<typeof CommentUnpin>;
