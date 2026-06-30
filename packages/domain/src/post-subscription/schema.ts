import { PostId, WorkspaceId } from "@feeblo/id";
import { Schema as S } from "effect";

export const PostSubscription = S.Struct({
  id: S.String,
  postId: S.String,
  organizationId: S.String,
  userId: S.String,
  memberId: S.Union([S.String, S.Null]),
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});

export type TPostSubscription = S.Schema.Type<typeof PostSubscription>;

export const PostSubscriptionList = S.Struct({
  organizationId: WorkspaceId.schema,
  postId: PostId.schema,
});

export type TPostSubscriptionList = S.Schema.Type<typeof PostSubscriptionList>;

export const PostSubscriptionCreate = S.Struct({
  organizationId: WorkspaceId.schema,
  postId: PostId.schema,
});

export type TPostSubscriptionCreate = S.Schema.Type<
  typeof PostSubscriptionCreate
>;

export const PostSubscriptionDelete = S.Struct({
  organizationId: WorkspaceId.schema,
  postId: PostId.schema,
});

export type TPostSubscriptionDelete = S.Schema.Type<
  typeof PostSubscriptionDelete
>;
