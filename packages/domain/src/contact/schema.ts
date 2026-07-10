import { CompanyId, ContactId } from "@feeblo/id";
import * as S from "effect/Schema";

export const ContactUpsert = S.Struct({
  organizationId: S.String,
  externalId: S.optional(S.String),
  email: S.optional(S.String),
  name: S.optional(S.String),
  phone: S.optional(S.String),
  companyId: S.optional(S.NullOr(S.String)),
});

export type TContactUpsert = S.Schema.Type<typeof ContactUpsert>;

export const Contact = S.Struct({
  id: ContactId.schema,
  organizationId: S.String,
  externalId: S.NullOr(S.String),
  email: S.NullOr(S.String),
  name: S.NullOr(S.String),
  phone: S.NullOr(S.String),
  companyId: S.NullOr(CompanyId.schema),
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});

export type TContact = S.Schema.Type<typeof Contact>;

export const CompanyUpsert = S.Struct({
  organizationId: S.String,
  externalId: S.optional(S.String),
  name: S.String,
  domain: S.optional(S.String),
});

export type TCompanyUpsert = S.Schema.Type<typeof CompanyUpsert>;

export const Company = S.Struct({
  id: CompanyId.schema,
  organizationId: S.String,
  externalId: S.NullOr(S.String),
  name: S.String,
  domain: S.NullOr(S.String),
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});

export type TCompany = S.Schema.Type<typeof Company>;
