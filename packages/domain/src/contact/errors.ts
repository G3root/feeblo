import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import {
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export class DataValidationError extends Schema.TaggedErrorClass<DataValidationError>()(
  "DataValidationError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 400, identifier: "DataValidationError" }
) {}

export class ContactNotFoundError extends Schema.TaggedErrorClass<ContactNotFoundError>()(
  "ContactNotFoundError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 404, identifier: "ContactNotFoundError" }
) {}

export class CompanyNotFoundError extends Schema.TaggedErrorClass<CompanyNotFoundError>()(
  "CompanyNotFoundError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 404, identifier: "CompanyNotFoundError" }
) {}

export class AttributeDefinitionNotFoundError extends Schema.TaggedErrorClass<AttributeDefinitionNotFoundError>()(
  "AttributeDefinitionNotFoundError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 404, identifier: "AttributeDefinitionNotFoundError" }
) {}

export class FailedToCreateContactError extends Schema.TaggedErrorClass<FailedToCreateContactError>()(
  "FailedToCreateContactError",
  {},
  { httpApiStatus: 500, identifier: "FailedToCreateContactError" }
) {}

export class FailedToUpdateContactError extends Schema.TaggedErrorClass<FailedToUpdateContactError>()(
  "FailedToUpdateContactError",
  {},
  { httpApiStatus: 500, identifier: "FailedToUpdateContactError" }
) {}

export class FailedToDeleteContactError extends Schema.TaggedErrorClass<FailedToDeleteContactError>()(
  "FailedToDeleteContactError",
  {},
  { httpApiStatus: 500, identifier: "FailedToDeleteContactError" }
) {}

export class FailedToCreateCompanyError extends Schema.TaggedErrorClass<FailedToCreateCompanyError>()(
  "FailedToCreateCompanyError",
  {},
  { httpApiStatus: 500, identifier: "FailedToCreateCompanyError" }
) {}

export class FailedToUpdateCompanyError extends Schema.TaggedErrorClass<FailedToUpdateCompanyError>()(
  "FailedToUpdateCompanyError",
  {},
  { httpApiStatus: 500, identifier: "FailedToUpdateCompanyError" }
) {}

export class FailedToDeleteCompanyError extends Schema.TaggedErrorClass<FailedToDeleteCompanyError>()(
  "FailedToDeleteCompanyError",
  {},
  { httpApiStatus: 500, identifier: "FailedToDeleteCompanyError" }
) {}

export class FailedToCreateAttributeDefinitionError extends Schema.TaggedErrorClass<FailedToCreateAttributeDefinitionError>()(
  "FailedToCreateAttributeDefinitionError",
  {},
  { httpApiStatus: 500, identifier: "FailedToCreateAttributeDefinitionError" }
) {}

export class FailedToUpdateAttributeDefinitionError extends Schema.TaggedErrorClass<FailedToUpdateAttributeDefinitionError>()(
  "FailedToUpdateAttributeDefinitionError",
  {},
  { httpApiStatus: 500, identifier: "FailedToUpdateAttributeDefinitionError" }
) {}

export class FailedToDeleteAttributeDefinitionError extends Schema.TaggedErrorClass<FailedToDeleteAttributeDefinitionError>()(
  "FailedToDeleteAttributeDefinitionError",
  {},
  { httpApiStatus: 500, identifier: "FailedToDeleteAttributeDefinitionError" }
) {}

export class FailedToUpsertAttributeValueError extends Schema.TaggedErrorClass<FailedToUpsertAttributeValueError>()(
  "FailedToUpsertAttributeValueError",
  {},
  { httpApiStatus: 500, identifier: "FailedToUpsertAttributeValueError" }
) {}

export const ContactServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  DataValidationError,
  ContactNotFoundError,
  CompanyNotFoundError,
  AttributeDefinitionNotFoundError,
  FailedToCreateContactError,
  FailedToUpdateContactError,
  FailedToDeleteContactError,
  FailedToCreateCompanyError,
  FailedToUpdateCompanyError,
  FailedToDeleteCompanyError,
  FailedToCreateAttributeDefinitionError,
  FailedToUpdateAttributeDefinitionError,
  FailedToDeleteAttributeDefinitionError,
  FailedToUpsertAttributeValueError,
]);
