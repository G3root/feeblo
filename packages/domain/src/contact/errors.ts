import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export class DataValidationError extends Schema.TaggedError<DataValidationError>()(
  "DataValidationError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 400, identifier: "DataValidationError" }
) {}

export class ContactNotFoundError extends Schema.TaggedError<ContactNotFoundError>()(
  "ContactNotFoundError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 404, identifier: "ContactNotFoundError" }
) {}

export class ContactAlreadyExistsError extends Schema.TaggedError<ContactAlreadyExistsError>()(
  "ContactAlreadyExistsError",
  { message: Schema.optional(Schema.String) },
  { httpApiStatus: 409, identifier: "ContactAlreadyExistsError" }
) {}

export class FailedToCreateContactError extends Schema.TaggedError<FailedToCreateContactError>()(
  "FailedToCreateContactError",
  {},
  { httpApiStatus: 500, identifier: "FailedToCreateContactError" }
) {}

export class FailedToUpdateContactError extends Schema.TaggedError<FailedToUpdateContactError>()(
  "FailedToUpdateContactError",
  {},
  { httpApiStatus: 500, identifier: "FailedToUpdateContactError" }
) {}

export class FailedToDeleteContactError extends Schema.TaggedError<FailedToDeleteContactError>()(
  "FailedToDeleteContactError",
  {},
  { httpApiStatus: 500, identifier: "FailedToDeleteContactError" }
) {}

export const ContactServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  BadRequestError,
  DataValidationError,
  ContactAlreadyExistsError,
  ContactNotFoundError,
  FailedToCreateContactError,
  FailedToUpdateContactError,
  FailedToDeleteContactError,
]);
