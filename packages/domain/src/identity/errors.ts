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

/**
 * The subject resolves, but attributing the action to it would have to create a
 * new contact row and the workspace's plan has no CRM entry room left.
 *
 * Separate from {@link InvalidSubjectError} because the subject is fine — the
 * plan is the obstacle, and the two need different answers from a caller: this
 * one is a plan limit to upgrade out of, the other is a request to fix. Raised
 * at the insert itself rather than before resolution, so a write attributed to a
 * customer who already exists is never refused by a full CRM.
 */
export class CrmEntryLimitReachedError extends Schema.TaggedError<CrmEntryLimitReachedError>()(
  "CrmEntryLimitReachedError",
  { message: Schema.optional(Schema.String) },
  { httpApiStatus: 402, identifier: "CrmEntryLimitReachedError" }
) {}

export const IdentityServiceErrors = Schema.Union([
  InternalServerError,
  SubjectNotFoundError,
  InvalidSubjectError,
  CrmEntryLimitReachedError,
]);
