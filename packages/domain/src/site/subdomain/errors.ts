import * as Schema from "effect/Schema";

export class ProfanityError extends Schema.TaggedErrorClass<ProfanityError>()(
  "ProfanityError",

  { message: Schema.String },
  { httpApiStatus: 400, identifier: "ProfanityError" }
) {}

export class ReservedSubdomainError extends Schema.TaggedErrorClass<ReservedSubdomainError>()(
  "ReservedSubdomainError",
  { message: Schema.String },
  { httpApiStatus: 400, identifier: "ReservedSubdomainError" }
) {}
