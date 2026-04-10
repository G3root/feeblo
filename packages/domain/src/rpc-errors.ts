import { HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

export class BadRequestError extends Schema.TaggedError<BadRequestError>()(
  "BadRequestError",
  {
    message: Schema.optional(Schema.String),
  },
  HttpApiSchema.annotations({ status: 400, identifier: "BadRequestError" })
) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "NotFoundError",
  {
    message: Schema.optional(Schema.String),
  },
  HttpApiSchema.annotations({ status: 404, identifier: "NotFoundError" })
) {}

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  "UnauthorizedError",
  {
    message: Schema.optional(Schema.String),
  },
  HttpApiSchema.annotations({ status: 401, identifier: "UnauthorizedError" })
) {}

export class InternalServerError extends Schema.TaggedError<InternalServerError>()(
  "InternalServerError",
  {
    message: Schema.optional(Schema.String),
  },
  HttpApiSchema.annotations({ status: 500, identifier: "InternalServerError" })
) {}
