import * as Schema from "effect/Schema";

import { InternalServerError } from "../rpc-errors";

/**
 * An explicit subject identifier (`userId` or `contactId`) was supplied but
 * does not resolve within the organization.
 */
export class SubjectNotFoundError extends Schema.TaggedError<SubjectNotFoundError>()(
  "SubjectNotFoundError",
  { message: Schema.optional(Schema.String) },
  { httpApiStatus: 404, identifier: "SubjectNotFoundError" }
) {}

/**
 * The subject cannot be resolved to the shape the action requires — for
 * example a vote or comment on behalf of a contact that has neither a linked
 * account nor an email to provision one from.
 */
export class InvalidSubjectError extends Schema.TaggedError<InvalidSubjectError>()(
  "InvalidSubjectError",
  { message: Schema.optional(Schema.String) },
  { httpApiStatus: 400, identifier: "InvalidSubjectError" }
) {}

export const IdentityServiceErrors = Schema.Union([
  InternalServerError,
  SubjectNotFoundError,
  InvalidSubjectError,
]);
