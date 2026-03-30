import { HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";
import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export class FailedToCreateTagError extends Schema.TaggedError<FailedToCreateTagError>()(
  "FailedToCreateTagError",
  {},
  HttpApiSchema.annotations({
    status: 500,
    identifier: "FailedToCreateTagError",
  })
) {}

export class FailedToUpdateTagError extends Schema.TaggedError<FailedToUpdateTagError>()(
  "FailedToUpdateTagError",
  {},
  HttpApiSchema.annotations({
    status: 500,
    identifier: "FailedToUpdateTagError",
  })
) {}

export class FailedToDeleteTagError extends Schema.TaggedError<FailedToDeleteTagError>()(
  "FailedToDeleteTagError",
  {},
  HttpApiSchema.annotations({
    status: 500,
    identifier: "FailedToDeleteTagError",
  })
) {}

export class FailedToSetTagAssignmentsError extends Schema.TaggedError<FailedToSetTagAssignmentsError>()(
  "FailedToSetTagAssignmentsError",
  {},
  HttpApiSchema.annotations({
    status: 500,
    identifier: "FailedToSetTagAssignmentsError",
  })
) {}

export const TagServiceErrors = Schema.Union(
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  BadRequestError,
  FailedToCreateTagError,
  FailedToUpdateTagError,
  FailedToDeleteTagError,
  FailedToSetTagAssignmentsError
);
