import { PostId, WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

import { PostCreateAuthor } from "../post/schema";

export const Upvote = S.Struct({
  id: S.String,
  postId: S.String,
  organizationId: S.String,
  /** Null on public endpoints for voters other than the session user. */
  userId: S.NullOr(S.String),
  memberId: S.Union([S.String, S.Null]),
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
  user: S.Struct({
    name: S.NullOr(S.String),
    image: S.NullOr(S.String),
  }),
});

export type TUpvote = S.Schema.Type<typeof Upvote>;

export const UpvoteList = S.Struct({
  organizationId: WorkspaceId.schema,
  postId: S.optional(PostId.schema),
});

export type TUpvoteList = S.Schema.Type<typeof UpvoteList>;

export const UpvoteToggle = S.Struct({
  organizationId: WorkspaceId.schema,
  postId: PostId.schema,
});

export type TUpvoteToggle = S.Schema.Type<typeof UpvoteToggle>;

/**
 * Adds one voter on behalf of a resolved customer (see plan-on-behalf.md).
 * Deliberately not a toggle: an admin must never remove someone else's vote
 * by accident. The author object is the shared on-behalf subject shape used
 * by `PostCreate`.
 */
export const UpvoteAddOnBehalf = S.Struct({
  organizationId: WorkspaceId.schema,
  postId: PostId.schema,
  author: PostCreateAuthor,
});

export type TUpvoteAddOnBehalf = S.Schema.Type<typeof UpvoteAddOnBehalf>;

/** Removes exactly one voter; removing a non-voter is a success no-op. */
export const UpvoteRemoveOnBehalf = S.Struct({
  organizationId: WorkspaceId.schema,
  postId: PostId.schema,
  userId: S.String.check(S.isMinLength(1)),
});

export type TUpvoteRemoveOnBehalf = S.Schema.Type<typeof UpvoteRemoveOnBehalf>;
