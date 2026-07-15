import {
  CompanyAttributeDefinitionId,
  ContactAttributeDefinitionId,
  WorkspaceId,
} from "@feeblo/id";
import * as S from "effect/Schema";

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

const AttributeDefinitionFields = {
  name: S.NonEmptyString,
  key: S.NonEmptyString,
  description: S.NullOr(S.String),
  type: AttributeType,
  isRequired: S.Boolean,
  organizationId: WorkspaceId.schema,
};

const StoredAttributeDefinitionFields = {
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
};

export const ContactAttributeDefinitionList = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type TContactAttributeDefinitionList = S.Schema.Type<
  typeof ContactAttributeDefinitionList
>;

export const ContactAttributeDefinitionCreate = S.Struct({
  id: ContactAttributeDefinitionId.schema,
  ...AttributeDefinitionFields,
});

export type TContactAttributeDefinitionCreate = S.Schema.Type<
  typeof ContactAttributeDefinitionCreate
>;

export const ContactAttributeDefinitionUpdate = S.Struct({
  id: ContactAttributeDefinitionId.schema,
  ...AttributeDefinitionFields,
});

export type TContactAttributeDefinitionUpdate = S.Schema.Type<
  typeof ContactAttributeDefinitionUpdate
>;

export const ContactAttributeDefinitionDelete = S.Struct({
  id: ContactAttributeDefinitionId.schema,
  organizationId: WorkspaceId.schema,
});

export type TContactAttributeDefinitionDelete = S.Schema.Type<
  typeof ContactAttributeDefinitionDelete
>;

export const ContactAttributeDefinition = S.Struct(
  StoredAttributeDefinitionFields
);

export type TContactAttributeDefinition = S.Schema.Type<
  typeof ContactAttributeDefinition
>;

export const CompanyAttributeDefinitionList = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type TCompanyAttributeDefinitionList = S.Schema.Type<
  typeof CompanyAttributeDefinitionList
>;

export const CompanyAttributeDefinitionCreate = S.Struct({
  id: CompanyAttributeDefinitionId.schema,
  ...AttributeDefinitionFields,
});

export type TCompanyAttributeDefinitionCreate = S.Schema.Type<
  typeof CompanyAttributeDefinitionCreate
>;

export const CompanyAttributeDefinitionUpdate = S.Struct({
  id: CompanyAttributeDefinitionId.schema,
  ...AttributeDefinitionFields,
});

export type TCompanyAttributeDefinitionUpdate = S.Schema.Type<
  typeof CompanyAttributeDefinitionUpdate
>;

export const CompanyAttributeDefinitionDelete = S.Struct({
  id: CompanyAttributeDefinitionId.schema,
  organizationId: WorkspaceId.schema,
});

export type TCompanyAttributeDefinitionDelete = S.Schema.Type<
  typeof CompanyAttributeDefinitionDelete
>;

export const CompanyAttributeDefinition = S.Struct(
  StoredAttributeDefinitionFields
);

export type TCompanyAttributeDefinition = S.Schema.Type<
  typeof CompanyAttributeDefinition
>;

const AttributeValueFields = {
  attributeId: S.String,
  valueText: S.NullOr(S.String),
  valueInteger: S.NullOr(S.Number),
  valueDecimal: S.NullOr(S.Number),
  valueBoolean: S.NullOr(S.Boolean),
  valueDate: S.NullOr(S.DateFromString),
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
};

const AttributeValueUpsertFields = {
  id: S.optional(S.String),
  attributeId: S.String,
  value: S.NullOr(S.Union([S.String, S.Number, S.Boolean, S.DateFromString])),
};

export const ContactAttributeValueUpsert = S.Struct({
  ...AttributeValueUpsertFields,
  contactId: S.String,
});

export type TContactAttributeValueUpsert = S.Schema.Type<
  typeof ContactAttributeValueUpsert
>;

export const ContactAttributeValueList = S.Struct({
  contactId: S.String,
});

export type TContactAttributeValueList = S.Schema.Type<
  typeof ContactAttributeValueList
>;

export const ContactAttributeValue = S.Struct({
  id: S.String,
  contactId: S.String,
  ...AttributeValueFields,
});

export type TContactAttributeValue = S.Schema.Type<
  typeof ContactAttributeValue
>;

export const CompanyAttributeValueUpsert = S.Struct({
  ...AttributeValueUpsertFields,
  companyId: S.String,
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
  ...AttributeValueFields,
});

export type TCompanyAttributeValue = S.Schema.Type<
  typeof CompanyAttributeValue
>;
