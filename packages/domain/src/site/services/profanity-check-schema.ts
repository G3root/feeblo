import * as Schema from "effect/Schema";

export const ProfanityCheckResponse = Schema.Struct({
  valid: Schema.Boolean,
  message: Schema.String,
  type: Schema.optional(Schema.Literals(["profanity", "reserved"])),
});

export type TProfanityCheckResponse = Schema.Schema.Type<
  typeof ProfanityCheckResponse
>;

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
