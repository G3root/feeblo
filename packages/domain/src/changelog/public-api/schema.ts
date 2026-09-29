import * as Schema from "effect/Schema";

import { PUBLIC_API_PAGE_MAX_LIMIT } from "../../public-api/common";

/**
 * The changelog resource: what the changelog endpoints return, and the typed
 * input every changelog operation takes.
 *
 * The `*Query`/`*Params` schemas describe the HTTP projection; the `*Input`
 * schemas are what an operation receives. Create and update reuse their payload
 * schemas as inputs because a JSON body is already the typed shape.
 */

/**
 * Changelog entry status. Restated rather than imported from the dashboard's
 * `changelog/schema.ts` for the same reason every other DTO here is: the
 * published vocabulary belongs to this module, so a change to the dashboard
 * schema cannot silently change what a key receives.
 */
export const PublicApiChangelogStatus = Schema.Literals([
  "draft",
  "scheduled",
  "published",
]);

export type TPublicApiChangelogStatus = Schema.Schema.Type<
  typeof PublicApiChangelogStatus
>;

/**
 * A changelog entry without its body.
 *
 * Carries no author and no internal identifier: a machine key is not a member,
 * and `changelog` also holds `creatorId` and `creatorMemberId`, which no
 * public payload may name. The workspace is not named either — a key reads
 * exactly one workspace, so the field would be the same string everywhere.
 */
export const PublicApiChangelogSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  slug: Schema.String,
  excerpt: Schema.String,
  coverImage: Schema.NullOr(Schema.String),
  status: PublicApiChangelogStatus,
  scheduledAt: Schema.NullOr(Schema.DateFromString),
  publishedAt: Schema.NullOr(Schema.DateFromString),
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString,
});

export type TPublicApiChangelogSummary = Schema.Schema.Type<
  typeof PublicApiChangelogSummary
>;

/** Detail projection: the summary plus the stored, sanitized body. */
export const PublicApiChangelog = Schema.Struct({
  ...PublicApiChangelogSummary.fields,
  content: Schema.String,
});

export type TPublicApiChangelog = Schema.Schema.Type<typeof PublicApiChangelog>;

export const PublicApiChangelogPage = Schema.Struct({
  data: Schema.Array(PublicApiChangelogSummary),
  nextCursor: Schema.NullOr(Schema.String),
});

export type TPublicApiChangelogPage = Schema.Schema.Type<
  typeof PublicApiChangelogPage
>;

/** Query parameters, declared as strings and validated in the handler. */
export const ListChangelogQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
});

export const GetChangelogParams = Schema.Struct({
  changelogId: Schema.String,
});

const COVER_IMAGE_URL_PATTERN = /^https?:\/\/[^\s]+$/i;
const COVER_IMAGE_URL_MAX_LENGTH = 2048;

/**
 * The writable fields, in the shape both writes take.
 *
 * `slug` is optional on both: omitted or empty derives it from the title, and
 * a supplied value is normalized through the same `slugify` the dashboard
 * uses, so an id-looking string cannot become a URL and `UI Kit` and `ui-kit`
 * remain one slug rather than two entries that look identical to a reader.
 *
 * The timestamps are only meaningful next to the status that selects them, so
 * a publish must carry `publishedAt` and a schedule must carry `scheduledAt`;
 * the handler rejects the request otherwise instead of inventing a date that
 * would decide a reader's ordering.
 */
export const CreateChangelogPayload = Schema.Struct({
  title: Schema.String,
  slug: Schema.optional(Schema.String),
  content: Schema.String,
  coverImage: Schema.optional(
    Schema.NullOr(
      Schema.String.check(
        Schema.isPattern(COVER_IMAGE_URL_PATTERN),
        Schema.isMaxLength(COVER_IMAGE_URL_MAX_LENGTH)
      )
    )
  ),
  status: Schema.optional(PublicApiChangelogStatus),
  scheduledAt: Schema.optional(Schema.NullOr(Schema.DateFromString)),
  publishedAt: Schema.optional(Schema.NullOr(Schema.DateFromString)),
});

export type TCreateChangelogPayload = Schema.Schema.Type<
  typeof CreateChangelogPayload
>;

export const UpdateChangelogParams = Schema.Struct({
  changelogId: Schema.String,
});

/**
 * A full replacement of the writable fields.
 *
 * `status` is required here but optional on a create: a create that omits it
 * makes a draft, while an update that omitted it would silently move an entry —
 * publishing a draft or reverting a published entry — by leaving a field out.
 * The caller has to say which status it intends.
 */
export const UpdateChangelogPayload = Schema.Struct({
  title: Schema.String,
  slug: Schema.optional(Schema.String),
  content: Schema.String,
  coverImage: Schema.optional(
    Schema.NullOr(
      Schema.String.check(
        Schema.isPattern(COVER_IMAGE_URL_PATTERN),
        Schema.isMaxLength(COVER_IMAGE_URL_MAX_LENGTH)
      )
    )
  ),
  status: PublicApiChangelogStatus,
  scheduledAt: Schema.optional(Schema.NullOr(Schema.DateFromString)),
  publishedAt: Schema.optional(Schema.NullOr(Schema.DateFromString)),
});

export type TUpdateChangelogPayload = Schema.Schema.Type<
  typeof UpdateChangelogPayload
>;

export const DeleteChangelogParams = Schema.Struct({
  changelogId: Schema.String,
});

/** Typed input for a page of the workspace's changelog. */
export const ListChangelogInput = Schema.Struct({
  cursor: Schema.optional(
    Schema.String.annotate({ description: "Opaque page cursor" })
  ),
  limit: Schema.optional(
    Schema.Finite.check(
      Schema.isInt(),
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(PUBLIC_API_PAGE_MAX_LIMIT)
    ).annotate({
      description: "Page size, 1–100",
    })
  ),
  status: Schema.optional(PublicApiChangelogStatus),
});

/** Typed input for reading one changelog entry. */
export const GetChangelogInput = Schema.Struct({
  changelogId: Schema.String,
});

/** The create body is already the typed input. */
export const CreateChangelogInput = CreateChangelogPayload;

/** The update body plus the entry it replaces. */
export const UpdateChangelogInput = Schema.Struct({
  ...UpdateChangelogPayload.fields,
  changelogId: Schema.String,
});

/** Typed input for deleting a changelog entry. */
export const DeleteChangelogInput = DeleteChangelogParams;
