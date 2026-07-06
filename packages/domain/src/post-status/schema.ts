import * as S from "effect/Schema";

export const PostStatusType = S.Literals([
  "PENDING",
  "REVIEW",
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
  "CLOSED",
]);

export const PostStatus = S.Struct({
  id: S.String,
  type: PostStatusType,
  orderIndex: S.Number,
  organizationId: S.String,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});

export type TPostStatus = S.Schema.Type<typeof PostStatus>;

export const PostStatusList = S.Struct({
  organizationId: S.String,
});

export type TPostStatusList = S.Schema.Type<typeof PostStatusList>;
