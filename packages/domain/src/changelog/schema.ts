import { PostStatusType } from "@feeblo/domain-contracts/post-status-type";
import { ChangelogId, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";

export const ChangelogStatus = S.Literals(["draft", "scheduled", "published"]);

export const Changelog = S.Struct({
  assetIds: S.optional(S.Array(S.String)),
  coverImage: S.NullOr(S.String),
  id: S.String,
  title: S.String,
  slug: S.String,
  content: S.String,
  excerpt: S.String,
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

/**
 * A post announced by a changelog entry, reduced to what the public detail
 * page renders (title, link, status).
 */
export const ChangelogLinkedPost = S.Struct({
  id: S.String,
  slug: S.String,
  status: PostStatusType,
  title: S.String,
});

export type TChangelogLinkedPost = S.Schema.Type<typeof ChangelogLinkedPost>;

/**
 * Public single-entry response: the entry body plus the posts it announced.
 * Embedding the linked posts keeps the public detail page from subscribing to
 * the whole post and changelog-link collections just to render one section.
 */
export const ChangelogDetail = S.Struct({
  ...Changelog.fields,
  posts: S.Array(ChangelogLinkedPost),
});

export type TChangelogDetail = S.Schema.Type<typeof ChangelogDetail>;

export const ChangelogList = S.Struct({
  organizationId: S.String,
});

export type TChangelogList = S.Schema.Type<typeof ChangelogList>;

export const ChangelogGet = S.Struct({
  organizationId: S.String,
  slug: S.String,
});

export type TChangelogGet = S.Schema.Type<typeof ChangelogGet>;

const COVER_IMAGE_URL_PATTERN = /^https?:\/\/[^\s]+$/i;
const COVER_IMAGE_URL_MAX_LENGTH = 2048;

const coverImageWithDefault = S.NullOr(
  S.String.pipe(
    S.check(S.isPattern(COVER_IMAGE_URL_PATTERN)),
    S.check(S.isMaxLength(COVER_IMAGE_URL_MAX_LENGTH))
  )
).pipe(S.withDecodingDefaultKey(Effect.succeed(null)));

export const ChangelogCreate = S.Struct({
  assetIds: S.Array(S.String).pipe(
    // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
    S.withDecodingDefaultKey(Effect.succeed([] as string[]))
  ),
  coverImage: coverImageWithDefault,
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
    // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
    S.withDecodingDefaultKey(Effect.succeed([] as string[]))
  ),
  coverImage: coverImageWithDefault,
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

/** Idempotent request to email subscribers about an already-published entry. */
export const ChangelogSendUpdate = S.Struct({
  id: ChangelogId.schema,
  organizationId: WorkspaceId.schema,
  requestId: S.NonEmptyString.pipe(S.check(S.isMaxLength(128))),
});

export type TChangelogSendUpdate = S.Schema.Type<typeof ChangelogSendUpdate>;

export const ChangelogDelete = S.Struct({
  id: ChangelogId.schema,
  organizationId: WorkspaceId.schema,
});

export type TChangelogDelete = S.Schema.Type<typeof ChangelogDelete>;
