import { Schema } from "effect";

export class BadRequestError extends Schema.TaggedErrorClass<BadRequestError>()(
  "BadRequestError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 400, identifier: "BadRequestError" }
) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
  "NotFoundError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 404, identifier: "NotFoundError" }
) {}

export class UnauthorizedError extends Schema.TaggedErrorClass<UnauthorizedError>()(
  "UnauthorizedError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 401, identifier: "UnauthorizedError" }
) {}

export class InternalServerError extends Schema.TaggedErrorClass<InternalServerError>()(
  "InternalServerError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 500, identifier: "InternalServerError" }
) {}
