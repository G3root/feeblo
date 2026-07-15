import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

export class CompanyNotFoundError extends Schema.TaggedErrorClass<CompanyNotFoundError>()(
  "CompanyNotFoundError",
  { message: Schema.optional(Schema.String) },
  { httpApiStatus: 404, identifier: "CompanyNotFoundError" }
) {}

export class CompanyAlreadyExistsError extends Schema.TaggedErrorClass<CompanyAlreadyExistsError>()(
  "CompanyAlreadyExistsError",
  { message: Schema.optional(Schema.String) },
  { httpApiStatus: 409, identifier: "CompanyAlreadyExistsError" }
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

export const CompanyServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  CompanyAlreadyExistsError,
  CompanyNotFoundError,
  FailedToCreateCompanyError,
  FailedToUpdateCompanyError,
  FailedToDeleteCompanyError,
]);
