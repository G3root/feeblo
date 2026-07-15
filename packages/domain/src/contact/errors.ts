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

export class ContactAlreadyExistsError extends Schema.TaggedErrorClass<ContactAlreadyExistsError>()(
  "ContactAlreadyExistsError",
  { message: Schema.optional(Schema.String) },
  { httpApiStatus: 409, identifier: "ContactAlreadyExistsError" }
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

export const ContactServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  DataValidationError,
  ContactAlreadyExistsError,
  ContactNotFoundError,
  FailedToCreateContactError,
  FailedToUpdateContactError,
  FailedToDeleteContactError,
]);
