import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

export class CompanyNotFoundError extends Schema.TaggedErrorClass<CompanyNotFoundError>()(
  "CompanyNotFoundError",
  { message: Schema.optional(Schema.String) },
  { httpApiStatus: 404, identifier: "CompanyNotFoundError" }
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

export const CompanyServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  CompanyNotFoundError,
  FailedToCreateCompanyError,
  FailedToUpdateCompanyError,
]);
