import { Schema as S } from "effect";

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
  id: S.String,
  organizationId: S.String,
  postId: S.String,
  content: S.String,
  visibility: S.Literals(["PUBLIC", "INTERNAL"]),
  parentCommentId: S.Union([S.String, S.Null]),
});

export type TCommentCreate = S.Schema.Type<typeof CommentCreate>;

export const CommentDelete = S.Struct({
  id: S.String,
  organizationId: S.String,
  postId: S.String,
});

export type TCommentDelete = S.Schema.Type<typeof CommentDelete>;

export const CommentUpdate = S.Struct({
  id: S.String,
  organizationId: S.String,
  postId: S.String,
  content: S.String,
});

export type TCommentUpdate = S.Schema.Type<typeof CommentUpdate>;
