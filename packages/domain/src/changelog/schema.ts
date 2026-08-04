import { ChangelogId, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";

export const ChangelogStatus = S.Literals(["draft", "scheduled", "published"]);

export type TChangelogStatus = S.Schema.Type<typeof ChangelogStatus>;

export const Changelog = S.Struct({
  assetIds: S.optional(S.Array(S.String)),
  id: S.String,
  title: S.String,
  slug: S.String,
  content: S.String,
  status: ChangelogStatus,
  scheduledAt: S.NullOr(S.DateFromString),
  publishedAt: S.NullOr(S.DateFromString),
  organizationId: S.String,
  creatorMemberId: S.NullOr(S.String),
  creatorId: S.NullOr(S.String),
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
  user: S.Struct({
    name: S.NullOr(S.String),
    image: S.NullOr(S.String),
  }),
});

export type TChangelog = S.Schema.Type<typeof Changelog>;

export const ChangelogList = S.Struct({
  organizationId: S.String,
});

export type TChangelogList = S.Schema.Type<typeof ChangelogList>;

export const ChangelogCreate = S.Struct({
  assetIds: S.Array(S.String).pipe(
    S.withDecodingDefaultKey(Effect.succeed([] as string[]))
  ),
  id: ChangelogId.schema,
  title: S.String,
  slug: S.String,
  content: S.String,
  status: ChangelogStatus,
  scheduledAt: S.NullOr(S.DateFromString),
  publishedAt: S.NullOr(S.DateFromString),
  organizationId: WorkspaceId.schema,
});

export type TChangelogCreate = S.Schema.Type<typeof ChangelogCreate>;

export const ChangelogUpdate = S.Struct({
  assetIds: S.Array(S.String).pipe(
    S.withDecodingDefaultKey(Effect.succeed([] as string[]))
  ),
  id: ChangelogId.schema,
  title: S.String,
  slug: S.String,
  content: S.String,
  status: ChangelogStatus,
  scheduledAt: S.NullOr(S.DateFromString),
  publishedAt: S.NullOr(S.DateFromString),
  organizationId: WorkspaceId.schema,
});

export type TChangelogUpdate = S.Schema.Type<typeof ChangelogUpdate>;

export const ChangelogDelete = S.Struct({
  id: ChangelogId.schema,
  organizationId: WorkspaceId.schema,
});

export type TChangelogDelete = S.Schema.Type<typeof ChangelogDelete>;
