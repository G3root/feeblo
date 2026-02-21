import { HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  "UnauthorizedError",
  {
    message: Schema.optional(Schema.String),
  },
  HttpApiSchema.annotations({ status: 401, identifier: "UnauthorizedError" })
) {}
