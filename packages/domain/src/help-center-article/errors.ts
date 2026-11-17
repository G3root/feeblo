import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from "../rpc-errors";

export class FailedToCreateHelpCenterArticleError extends Schema.TaggedError<FailedToCreateHelpCenterArticleError>()(
  "FailedToCreateHelpCenterArticleError",
  {},
  { httpApiStatus: 500, identifier: "FailedToCreateHelpCenterArticleError" }
) {}

export class FailedToUpdateHelpCenterArticleError extends Schema.TaggedError<FailedToUpdateHelpCenterArticleError>()(
  "FailedToUpdateHelpCenterArticleError",
  {},
  { httpApiStatus: 500, identifier: "FailedToUpdateHelpCenterArticleError" }
) {}

export class FailedToDeleteHelpCenterArticleError extends Schema.TaggedError<FailedToDeleteHelpCenterArticleError>()(
  "FailedToDeleteHelpCenterArticleError",
  {},
  { httpApiStatus: 500, identifier: "FailedToDeleteHelpCenterArticleError" }
) {}

/**
 * Slug collisions are a routine editing outcome, not a fault: two authors can
 * reasonably propose "Getting started" and `slugify` produces one key for both.
 */
export class HelpCenterArticleSlugTakenError extends Schema.TaggedError<HelpCenterArticleSlugTakenError>()(
  "HelpCenterArticleSlugTakenError",
  { slug: Schema.String },
  { httpApiStatus: 409, identifier: "HelpCenterArticleSlugTakenError" }
) {}

/**
 * The article moved while this edit was open.
 *
 * The update carries the status the editor observed and only writes rows still
 * in it, so an editor who saved a draft over a page a colleague published a
 * moment earlier is told rather than silently reverting the publication.
 */
export class HelpCenterArticleChangedError extends Schema.TaggedError<HelpCenterArticleChangedError>()(
  "HelpCenterArticleChangedError",
  {},
  { httpApiStatus: 409, identifier: "HelpCenterArticleChangedError" }
) {}

export const HelpCenterArticleServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  BadRequestError,
  NotFoundError,
  FailedToCreateHelpCenterArticleError,
  FailedToUpdateHelpCenterArticleError,
  FailedToDeleteHelpCenterArticleError,
  HelpCenterArticleSlugTakenError,
  HelpCenterArticleChangedError,
]);
