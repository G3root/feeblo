import { Schema } from "effect";
import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export class FailedToCreateTagError extends Schema.TaggedErrorClass<FailedToCreateTagError>()(
  "FailedToCreateTagError",
  {},
  { httpApiStatus: 500, identifier: "FailedToCreateTagError" }
) {}

export class FailedToUpdateTagError extends Schema.TaggedErrorClass<FailedToUpdateTagError>()(
  "FailedToUpdateTagError",
  {},
  { httpApiStatus: 500, identifier: "FailedToUpdateTagError" }
) {}

export class FailedToDeleteTagError extends Schema.TaggedErrorClass<FailedToDeleteTagError>()(
  "FailedToDeleteTagError",
  {},
  { httpApiStatus: 500, identifier: "FailedToDeleteTagError" }
) {}

export class FailedToSetTagAssignmentsError extends Schema.TaggedErrorClass<FailedToSetTagAssignmentsError>()(
  "FailedToSetTagAssignmentsError",
  {},
  { httpApiStatus: 500, identifier: "FailedToSetTagAssignmentsError" }
) {}

export const TagServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  BadRequestError,
  FailedToCreateTagError,
  FailedToUpdateTagError,
  FailedToDeleteTagError,
  FailedToSetTagAssignmentsError,
]);
