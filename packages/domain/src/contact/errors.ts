import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

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
  AttributeDefinitionNotFoundError,
  FailedToCreateContactError,
  FailedToUpdateContactError,
  FailedToUpsertAttributeValueError,
]);
