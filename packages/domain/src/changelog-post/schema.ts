import { ChangelogId, PostId, WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

export const ChangelogPost = S.Struct({
  changelogId: S.String,
  postId: S.String,
  organizationId: S.String,
  createdAt: S.DateFromString,
});

export type TChangelogPost = S.Schema.Type<typeof ChangelogPost>;

export const ChangelogPostList = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type TChangelogPostList = S.Schema.Type<typeof ChangelogPostList>;

export const ChangelogPostCreate = S.Struct({
  changelogId: ChangelogId.schema,
  postId: PostId.schema,
  organizationId: WorkspaceId.schema,
});

export type TChangelogPostCreate = S.Schema.Type<typeof ChangelogPostCreate>;

export const ChangelogPostDelete = ChangelogPostCreate;

export type TChangelogPostDelete = S.Schema.Type<typeof ChangelogPostDelete>;
