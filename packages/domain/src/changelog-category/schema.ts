import {
  ChangelogCategoryColorIcon,
  ChangelogCategoryIconType,
} from "@feeblo/db/validation-schema/changelog-category-icon-type";
import { ChangelogCategoryId, ChangelogId, WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

export const ChangelogCategory = S.Struct({
  id: S.String,
  name: S.String,
  iconType: ChangelogCategoryIconType,
  icon: S.String,
  organizationId: S.String,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});

export type TChangelogCategory = S.Schema.Type<typeof ChangelogCategory>;

export const ChangelogCategoryList = S.Struct({
  organizationId: S.String,
});

export type TChangelogCategoryList = S.Schema.Type<
  typeof ChangelogCategoryList
>;

export const ChangelogCategoryCreate = S.Struct({
  id: ChangelogCategoryId.schema,
  name: S.String,
  iconType: ChangelogCategoryColorIcon.iconType,
  icon: ChangelogCategoryColorIcon.schema,
  organizationId: WorkspaceId.schema,
});

export type TChangelogCategoryCreate = S.Schema.Type<
  typeof ChangelogCategoryCreate
>;

export const ChangelogCategoryUpdate = S.Struct({
  id: ChangelogCategoryId.schema,
  name: S.String,
  iconType: ChangelogCategoryColorIcon.iconType,
  icon: ChangelogCategoryColorIcon.schema,
  organizationId: WorkspaceId.schema,
});

export type TChangelogCategoryUpdate = S.Schema.Type<
  typeof ChangelogCategoryUpdate
>;

export const ChangelogCategoryDelete = S.Struct({
  id: ChangelogCategoryId.schema,
  organizationId: WorkspaceId.schema,
});

export type TChangelogCategoryDelete = S.Schema.Type<
  typeof ChangelogCategoryDelete
>;

export const ChangelogCategorySet = S.Struct({
  changelogId: ChangelogId.schema,
  organizationId: WorkspaceId.schema,
  categoryIds: S.Array(ChangelogCategoryId.schema),
});

export type TChangelogCategorySet = S.Schema.Type<typeof ChangelogCategorySet>;

export const ChangelogCategoryLink = S.Struct({
  id: S.String,
  changelogId: S.String,
  categoryId: S.String,
  organizationId: S.String,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});

export type TChangelogCategoryLink = S.Schema.Type<
  typeof ChangelogCategoryLink
>;
