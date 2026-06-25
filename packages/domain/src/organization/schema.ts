import { Schema as S } from "effect";

export const Organization = S.Struct({
  id: S.String,
  name: S.String,
  slug: S.String,
  logo: S.NullOr(S.String),
  createdAt: S.DateFromString,
});

export const OrganizationUpdate = S.Struct({
  organizationId: S.String,
  name: S.String,
  logo: S.NullOr(S.String),
});

export type TOrganizationUpdate = S.Schema.Type<typeof OrganizationUpdate>;
