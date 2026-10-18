import * as Schema from "effect/Schema";

import { PlanLockedError } from "../entitlement/errors";
import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export class AttributeDefinitionNotFoundError extends Schema.TaggedError<AttributeDefinitionNotFoundError>()(
  "AttributeDefinitionNotFoundError",
  { message: Schema.optional(Schema.String) },
  { httpApiStatus: 404, identifier: "AttributeDefinitionNotFoundError" }
) {}

export class FailedToUpsertAttributeValueError extends Schema.TaggedError<FailedToUpsertAttributeValueError>()(
  "FailedToUpsertAttributeValueError",
  {},
  { httpApiStatus: 500, identifier: "FailedToUpsertAttributeValueError" }
) {}

export const AttributeDefinitionServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  PlanLockedError,
  AttributeDefinitionNotFoundError,
  FailedToUpsertAttributeValueError,
  BadRequestError,
]);
