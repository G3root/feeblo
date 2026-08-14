import * as Schema from "effect/Schema";

export class ProfanityError extends Schema.TaggedError<ProfanityError>()(
  "ProfanityError",

  { message: Schema.String },
  { httpApiStatus: 400, identifier: "ProfanityError" }
) {}

export class ReservedSubdomainError extends Schema.TaggedError<ReservedSubdomainError>()(
  "ReservedSubdomainError",
  { message: Schema.String },
  { httpApiStatus: 400, identifier: "ReservedSubdomainError" }
) {}
