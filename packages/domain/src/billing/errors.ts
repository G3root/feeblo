import { HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";
import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export class FailedToCreateCheckoutError extends Schema.TaggedError<FailedToCreateCheckoutError>()(
  "FailedToCreateCheckoutError",
  {
    message: Schema.optional(Schema.String),
  },
  HttpApiSchema.annotations({
    status: 400,
    identifier: "FailedToCreateCheckoutError",
  })
) {}

export class FailedToCreatePortalError extends Schema.TaggedError<FailedToCreatePortalError>()(
  "FailedToCreatePortalError",
  {
    message: Schema.optional(Schema.String),
  },
  HttpApiSchema.annotations({
    status: 400,
    identifier: "FailedToCreatePortalError",
  })
) {}

export const BillingServiceErrors = Schema.Union(
  UnauthorizedError,
  BadRequestError,
  InternalServerError,
  PolicyDeniedError,
  FailedToCreateCheckoutError,
  FailedToCreatePortalError
);
