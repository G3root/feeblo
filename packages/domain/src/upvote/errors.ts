import * as Schema from "effect/Schema";

import {
  CrmEntryLimitReachedError,
  InvalidSubjectError,
  SubjectNotFoundError,
} from "../identity/errors";
import { PolicyDeniedError } from "../policy";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

export const UpvoteServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  // On-behalf voter management resolves a subject and can reject invalid
  // identifiers with the shared identity failures.
  SubjectNotFoundError,
  InvalidSubjectError,
  // Attributing to a subject that does not yet exist would create a contact,
  // which the plan may have no room for.
  CrmEntryLimitReachedError,
]);
