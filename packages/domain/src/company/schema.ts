import { WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

export const CommonCompanyFields = S.Struct({
  id: S.String,
  name: S.String,
  avatar: S.optional(S.String),
  externalCreatedAt: S.optional(S.DateFromString),
});

export type TCommonCompanyFields = S.Schema.Type<typeof CommonCompanyFields>;

export const CompanyUpsert = S.Struct({
  organizationId: S.String,
  externalId: S.optional(S.String),
  name: S.String,
  avatar: S.optional(S.String),
  externalCreatedAt: S.optional(S.DateFromString),
});

export type TCompanyUpsert = S.Schema.Type<typeof CompanyUpsert>;

export const Company = S.Struct({
  id: S.String,
  organizationId: S.String,
  externalId: S.NullOr(S.String),
  name: S.String,
  avatar: S.NullOr(S.String),
  externalCreatedAt: S.NullOr(S.DateFromString),
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});

export type TCompany = S.Schema.Type<typeof Company>;

export const CompanyList = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type TCompanyList = S.Schema.Type<typeof CompanyList>;
