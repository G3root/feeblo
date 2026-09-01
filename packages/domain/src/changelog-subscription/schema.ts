import { WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

export const ChangelogSubscription = S.Struct({
  id: S.String,
  organizationId: S.String,
  userId: S.String,
  memberId: S.Union([S.String, S.Null]),
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});

export type TChangelogSubscription = S.Schema.Type<
  typeof ChangelogSubscription
>;

export const ChangelogSubscriptionList = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type TChangelogSubscriptionList = S.Schema.Type<
  typeof ChangelogSubscriptionList
>;

export const ChangelogSubscriptionCreate = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type TChangelogSubscriptionCreate = S.Schema.Type<
  typeof ChangelogSubscriptionCreate
>;

export const ChangelogSubscriptionDelete = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type TChangelogSubscriptionDelete = S.Schema.Type<
  typeof ChangelogSubscriptionDelete
>;
