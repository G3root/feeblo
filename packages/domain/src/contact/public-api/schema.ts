import * as Schema from "effect/Schema";

import { PUBLIC_API_PAGE_MAX_LIMIT } from "../../public-api/common";

/**
 * The end-user resource: the workspace's own record of one of its customers.
 *
 * Hand-written and closed like every other DTO here. It carries the contact
 * id, the caller's own `externalId`, the display fields, and the company the
 * customer belongs to — and deliberately not the email or the account id
 * behind the record. An email is accepted as a lookup key and as an upsert
 * key, but it is never echoed back: a key travels into third-party
 * infrastructure, and the workspace can already address the person by
 * `externalId` without the API returning an address book. The `userId` that
 * links a contact to a Feeblo account is an internal actor identifier and has
 * no field here at all.
 */
export const PublicApiEndUser = Schema.Struct({
  id: Schema.String,
  externalId: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
  companyId: Schema.NullOr(Schema.String),
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString,
});

export type TPublicApiEndUser = Schema.Schema.Type<typeof PublicApiEndUser>;

export const PublicApiEndUserPage = Schema.Struct({
  data: Schema.Array(PublicApiEndUser),
  nextCursor: Schema.NullOr(Schema.String),
});

export type TPublicApiEndUserPage = Schema.Schema.Type<
  typeof PublicApiEndUserPage
>;

/** Query parameters, declared as strings and validated in the handler. */
export const ListEndUsersQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
  externalId: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
  companyId: Schema.optional(Schema.String),
});

export const GetEndUserParams = Schema.Struct({
  endUserId: Schema.String,
});

/**
 * The fields an upsert may set.
 *
 * At least one of `externalId` and `email` is required — the handler enforces
 * it — because without one there is no way to tell an update from a create,
 * and a second request would silently make a second person. An absent field is
 * left alone; an explicit `null` clears a nullable one. `email` and
 * `externalId` may be set, but an email or external id that already belongs to
 * a different end user is refused with `CONFLICT` rather than silently
 * reassigned.
 */
export const UpsertEndUserPayload = Schema.Struct({
  externalId: Schema.optional(Schema.NullOr(Schema.String)),
  email: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  avatarUrl: Schema.optional(Schema.NullOr(Schema.String)),
  companyId: Schema.optional(Schema.NullOr(Schema.String)),
});

export type TUpsertEndUserPayload = Schema.Schema.Type<
  typeof UpsertEndUserPayload
>;

/** Typed input for a page of the workspace's end users. */
export const ListEndUsersInput = Schema.Struct({
  companyId: Schema.optional(
    Schema.String.annotate({
      description: "Only customers belonging to this company",
    })
  ),
  cursor: Schema.optional(
    Schema.String.annotate({ description: "Opaque page cursor" })
  ),
  email: Schema.optional(
    Schema.String.annotate({
      description:
        "Only the customer with this email, matched case-insensitively",
    })
  ),
  externalId: Schema.optional(
    Schema.String.annotate({
      description: "Only the customer with this external id",
    })
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

export type TListEndUsersInput = Schema.Schema.Type<typeof ListEndUsersInput>;

/** Typed input for reading one end user by id. */
export const GetEndUserInput = Schema.Struct({
  endUserId: Schema.String,
});

export type TGetEndUserInput = Schema.Schema.Type<typeof GetEndUserInput>;

/** Typed input for creating or updating one end user. */
export const UpsertEndUserInput = Schema.Struct({
  externalId: Schema.optional(Schema.NullOr(Schema.String)),
  email: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  avatarUrl: Schema.optional(Schema.NullOr(Schema.String)),
  companyId: Schema.optional(Schema.NullOr(Schema.String)),
});

export type TUpsertEndUserInput = Schema.Schema.Type<typeof UpsertEndUserInput>;
