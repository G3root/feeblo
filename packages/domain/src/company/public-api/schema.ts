import * as Schema from "effect/Schema";

import { PUBLIC_API_PAGE_MAX_LIMIT } from "../../public-api/common";

/**
 * Where a company record came from.
 *
 * Written out rather than imported from the internal `EntitySource`, and named
 * after the field it types the way `PostStatusType` is: a repository source
 * type uses this same union, so a source added to the internal vocabulary fails
 * to compile there until it is named here too. That keeps a widening of the
 * public payload a deliberate edit — the DTO and its mapper — instead of
 * something a shared vocabulary does on its own. See ADR 0004.
 */
export const PublicApiCompanySourceType = Schema.Literals([
  "DASHBOARD",
  "WIDGET",
  "API",
  "IMPORT",
]);

export type TPublicApiCompanySourceType = Schema.Schema.Type<
  typeof PublicApiCompanySourceType
>;

/**
 * The company resource.
 *
 * A company is an account record: a name, the caller's own identifier for it,
 * an avatar, and where it came from. The people attached to it are deliberately
 * absent — a company's contacts, their emails, and their phone numbers are the
 * CRM data this version of the API does not expose — and so are the custom
 * attribute values a workspace may have defined, whose definitions are a
 * workspace-specific vocabulary rather than a fixed field.
 *
 * The workspace is not named either: a key reads exactly one workspace, so the
 * field would be the same string on every response.
 */
export const PublicApiCompany = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  externalId: Schema.NullOr(Schema.String),
  avatar: Schema.NullOr(Schema.String),
  externalCreatedAt: Schema.NullOr(Schema.DateFromString),
  source: PublicApiCompanySourceType,
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString,
});

export type TPublicApiCompany = Schema.Schema.Type<typeof PublicApiCompany>;

export const PublicApiCompanyPage = Schema.Struct({
  data: Schema.Array(PublicApiCompany),
  nextCursor: Schema.NullOr(Schema.String),
});

export type TPublicApiCompanyPage = Schema.Schema.Type<
  typeof PublicApiCompanyPage
>;

/** Query parameters, declared as strings and validated in the handler. */
export const ListCompaniesQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
});

export const GetCompanyParams = Schema.Struct({
  companyId: Schema.String,
});

/**
 * The id is minted by the server, never chosen by the caller.
 *
 * An integration that already has its own identifiers for these companies
 * carries them in `externalId`, which is unique per workspace, rather than
 * trying to make the primary key agree with a system the workspace does not
 * control.
 *
 * `externalCreatedAt` is the caller's own notion of when the company was
 * created. It is stored beside `createdAt` rather than replacing it, the same
 * way the dashboard records it.
 */
export const CreateCompanyPayload = Schema.Struct({
  name: Schema.String,
  externalId: Schema.optional(Schema.NullOr(Schema.String)),
  avatar: Schema.optional(Schema.NullOr(Schema.String)),
  externalCreatedAt: Schema.optional(Schema.NullOr(Schema.DateFromString)),
});

export type TCreateCompanyPayload = Schema.Schema.Type<
  typeof CreateCompanyPayload
>;

export const UpdateCompanyParams = Schema.Struct({
  companyId: Schema.String,
});

/**
 * A partial update: an absent field is left alone, `null` clears it.
 *
 * `name` is not nullable because a company without a name is not a company,
 * and the same holds for the unique index the name carries. A body that names
 * no field at all is rejected rather than being answered as a successful write
 * that changed nothing.
 */
export const UpdateCompanyPayload = Schema.Struct({
  name: Schema.optional(Schema.String),
  externalId: Schema.optional(Schema.NullOr(Schema.String)),
  avatar: Schema.optional(Schema.NullOr(Schema.String)),
  externalCreatedAt: Schema.optional(Schema.NullOr(Schema.DateFromString)),
});

export type TUpdateCompanyPayload = Schema.Schema.Type<
  typeof UpdateCompanyPayload
>;

export const DeleteCompanyParams = Schema.Struct({
  companyId: Schema.String,
});

/** Typed input for a page of the workspace's companies. */
export const ListCompaniesInput = Schema.Struct({
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
});

/** Typed input for reading one company. */
export const GetCompanyInput = Schema.Struct({
  companyId: Schema.String,
});

/** Typed input for creating a company. */
export const CreateCompanyInput = Schema.Struct({
  name: Schema.String.annotate({ description: "The company's name" }),
  externalId: Schema.optional(
    Schema.NullOr(Schema.String).annotate({
      description: "The caller's own identifier for the company",
    })
  ),
  avatar: Schema.optional(Schema.NullOr(Schema.String)),
  externalCreatedAt: Schema.optional(Schema.NullOr(Schema.DateFromString)),
});

/** Typed input for updating a company. */
export const UpdateCompanyInput = Schema.Struct({
  companyId: Schema.String,
  name: Schema.optional(Schema.String),
  externalId: Schema.optional(Schema.NullOr(Schema.String)),
  avatar: Schema.optional(Schema.NullOr(Schema.String)),
  externalCreatedAt: Schema.optional(Schema.NullOr(Schema.DateFromString)),
});

/** Typed input for deleting a company. */
export const DeleteCompanyInput = Schema.Struct({
  companyId: Schema.String,
});
