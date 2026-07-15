import { CompanyAttributeDefinitionId, WorkspaceId } from "@feeblo/id";
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

export const AttributeType = S.Literals([
  "TEXT",
  "INTEGER",
  "DECIMAL",
  "BOOLEAN",
  "DATE",
]);

export const AttributeConfig = S.Struct({
  min: S.optional(S.Number),
  max: S.optional(S.Number),
  pattern: S.optional(S.String),
});

export const CompanyAttributeDefinitionList = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type TCompanyAttributeDefinitionList = S.Schema.Type<
  typeof CompanyAttributeDefinitionList
>;

export const CompanyAttributeDefinitionCreate = S.Struct({
  id: CompanyAttributeDefinitionId.schema,
  name: S.NonEmptyString,
  key: S.NonEmptyString,
  description: S.NullOr(S.String),
  type: AttributeType,
  isRequired: S.Boolean,
  organizationId: WorkspaceId.schema,
});

export type TCompanyAttributeDefinitionCreate = S.Schema.Type<
  typeof CompanyAttributeDefinitionCreate
>;

export const CompanyAttributeDefinition = S.Struct({
  id: S.String,
  name: S.String,
  key: S.String,
  description: S.NullOr(S.String),
  type: AttributeType,
  config: S.NullOr(AttributeConfig),
  isRequired: S.Boolean,
  organizationId: S.String,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});

export type TCompanyAttributeDefinition = S.Schema.Type<
  typeof CompanyAttributeDefinition
>;

export const CompanyAttributeValueUpsert = S.Struct({
  id: S.optional(S.String),
  companyId: S.String,
  attributeId: S.String,
  value: S.NullOr(S.Union([S.String, S.Number, S.Boolean, S.DateFromString])),
});

export type TCompanyAttributeValueUpsert = S.Schema.Type<
  typeof CompanyAttributeValueUpsert
>;

export const CompanyAttributeValueList = S.Struct({
  companyId: S.String,
});

export type TCompanyAttributeValueList = S.Schema.Type<
  typeof CompanyAttributeValueList
>;

export const CompanyAttributeValue = S.Struct({
  id: S.String,
  companyId: S.String,
  attributeId: S.String,
  valueText: S.NullOr(S.String),
  valueInteger: S.NullOr(S.Number),
  valueDecimal: S.NullOr(S.Number),
  valueBoolean: S.NullOr(S.Boolean),
  valueDate: S.NullOr(S.DateFromString),
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});

export type TCompanyAttributeValue = S.Schema.Type<
  typeof CompanyAttributeValue
>;
