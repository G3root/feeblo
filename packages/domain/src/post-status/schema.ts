import { PostStatusType } from "@feeblo/domain-contracts/post-status-type";
import * as S from "effect/Schema";

// Re-exported so client packages can use the status-type vocabulary without
// importing `@feeblo/db` directly.
export {
  PostStatusType,
  type TPostStatusType,
} from "@feeblo/domain-contracts/post-status-type";

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
