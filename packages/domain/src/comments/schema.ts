import { CommentId, PostId, WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

export const Comment = S.Struct({
  id: S.String,
  content: S.String,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
  organizationId: S.String,
  postId: S.String,
  userId: S.String,
  visibility: S.Literals(["PUBLIC", "INTERNAL"]),
  parentCommentId: S.Union([S.String, S.Null]),
  memberId: S.Union([S.String, S.Null]),
  user: S.Struct({
    name: S.String,
  }),
});

export type TComment = S.Schema.Type<typeof Comment>;

export const CommentList = S.Struct({
  organizationId: S.String,
  postId: S.String,
});

export type TCommentList = S.Schema.Type<typeof CommentList>;

export const CommentCreate = S.Struct({
  id: CommentId.schema,
  organizationId: WorkspaceId.schema,
  postId: PostId.schema,
  content: S.String,
  visibility: S.Literals(["PUBLIC", "INTERNAL"]),
  parentCommentId: S.Union([CommentId.schema, S.Null]),
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
  content: S.String,
  visibility: S.Literals(["PUBLIC", "INTERNAL"]),
});

export type TCommentUpdate = S.Schema.Type<typeof CommentUpdate>;
