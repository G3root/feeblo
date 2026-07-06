import { PostId, WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

export const Upvote = S.Struct({
  id: S.String,
  postId: S.String,
  organizationId: S.String,
  userId: S.String,
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
