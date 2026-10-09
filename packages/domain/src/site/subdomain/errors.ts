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

/**
 * The candidate is not a single DNS label, so interpolating it into
 * `https://<subdomain>.<root>` would produce a different host (a `@` becomes
 * userinfo, a `.` becomes an extra label) or an unroutable one.
 */
export class InvalidSubdomainError extends Schema.TaggedError<InvalidSubdomainError>()(
  "InvalidSubdomainError",
  { message: Schema.String },
  { httpApiStatus: 400, identifier: "InvalidSubdomainError" }
) {}
