import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export class CompanyNotFoundError extends Schema.TaggedError<CompanyNotFoundError>()(
  "CompanyNotFoundError",
  { message: Schema.optional(Schema.String) },
  { httpApiStatus: 404, identifier: "CompanyNotFoundError" }
) {}

export class CompanyAlreadyExistsError extends Schema.TaggedError<CompanyAlreadyExistsError>()(
  "CompanyAlreadyExistsError",
  { message: Schema.optional(Schema.String) },
  { httpApiStatus: 409, identifier: "CompanyAlreadyExistsError" }
) {}

export class FailedToCreateCompanyError extends Schema.TaggedError<FailedToCreateCompanyError>()(
  "FailedToCreateCompanyError",
  {},
  { httpApiStatus: 500, identifier: "FailedToCreateCompanyError" }
) {}

export class FailedToUpdateCompanyError extends Schema.TaggedError<FailedToUpdateCompanyError>()(
  "FailedToUpdateCompanyError",
  {},
  { httpApiStatus: 500, identifier: "FailedToUpdateCompanyError" }
) {}

export class FailedToDeleteCompanyError extends Schema.TaggedError<FailedToDeleteCompanyError>()(
  "FailedToDeleteCompanyError",
  {},
  { httpApiStatus: 500, identifier: "FailedToDeleteCompanyError" }
) {}

export const CompanyServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  BadRequestError,
  CompanyAlreadyExistsError,
  CompanyNotFoundError,
  FailedToCreateCompanyError,
  FailedToUpdateCompanyError,
  FailedToDeleteCompanyError,
]);
