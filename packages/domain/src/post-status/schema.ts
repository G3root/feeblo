import { Schema } from "effect";

export const PostStatusType = Schema.Literal(
  "PENDING",
  "REVIEW",
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
  "CLOSED"
);

export class PostStatus extends Schema.Class<PostStatus>(
  "PostStatus"
)({
  id: Schema.String,
  type: PostStatusType,
  orderIndex: Schema.Number,
  organizationId: Schema.String,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

export type TPostStatus = Schema.Schema.Type<typeof PostStatus>;

export const PostStatusList = Schema.Struct({
  organizationId: Schema.String,
});

export type TPostStatusList = Schema.Schema.Type<
  typeof PostStatusList
>;
