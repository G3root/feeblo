import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export class FailedToCreateHelpCenterTopicError extends Schema.TaggedError<FailedToCreateHelpCenterTopicError>()(
  "FailedToCreateHelpCenterTopicError",
  {},
  { httpApiStatus: 500, identifier: "FailedToCreateHelpCenterTopicError" }
) {}

export class FailedToUpdateHelpCenterTopicError extends Schema.TaggedError<FailedToUpdateHelpCenterTopicError>()(
  "FailedToUpdateHelpCenterTopicError",
  {},
  { httpApiStatus: 500, identifier: "FailedToUpdateHelpCenterTopicError" }
) {}

/**
 * A topic that still has articles cannot be deleted.
 *
 * The database enforces this with `ON DELETE RESTRICT` on the article's
 * composite foreign key, and this error is that refusal translated into
 * something an editor can act on: move or delete the articles first. Returning
 * `FailedToDeleteHelpCenterTopicError` would file a routine, expected refusal
 * as a server fault.
 */
export class HelpCenterTopicNotEmptyError extends Schema.TaggedError<HelpCenterTopicNotEmptyError>()(
  "HelpCenterTopicNotEmptyError",
  { articleCount: Schema.Finite },
  { httpApiStatus: 409, identifier: "HelpCenterTopicNotEmptyError" }
) {}

export class HelpCenterTopicSlugTakenError extends Schema.TaggedError<HelpCenterTopicSlugTakenError>()(
  "HelpCenterTopicSlugTakenError",
  { slug: Schema.String },
  { httpApiStatus: 409, identifier: "HelpCenterTopicSlugTakenError" }
) {}

export class FailedToDeleteHelpCenterTopicError extends Schema.TaggedError<FailedToDeleteHelpCenterTopicError>()(
  "FailedToDeleteHelpCenterTopicError",
  {},
  { httpApiStatus: 500, identifier: "FailedToDeleteHelpCenterTopicError" }
) {}

export const HelpCenterTopicServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  BadRequestError,
  FailedToCreateHelpCenterTopicError,
  FailedToUpdateHelpCenterTopicError,
  FailedToDeleteHelpCenterTopicError,
  HelpCenterTopicNotEmptyError,
  HelpCenterTopicSlugTakenError,
]);
