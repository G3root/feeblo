import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export class FailedToCreateTagError extends Schema.TaggedError<FailedToCreateTagError>()(
  "FailedToCreateTagError",
  {},
  { httpApiStatus: 500, identifier: "FailedToCreateTagError" }
) {}

export class FailedToUpdateTagError extends Schema.TaggedError<FailedToUpdateTagError>()(
  "FailedToUpdateTagError",
  {},
  { httpApiStatus: 500, identifier: "FailedToUpdateTagError" }
) {}

export class FailedToDeleteTagError extends Schema.TaggedError<FailedToDeleteTagError>()(
  "FailedToDeleteTagError",
  {},
  { httpApiStatus: 500, identifier: "FailedToDeleteTagError" }
) {}

export class FailedToSetTagAssignmentsError extends Schema.TaggedError<FailedToSetTagAssignmentsError>()(
  "FailedToSetTagAssignmentsError",
  {},
  { httpApiStatus: 500, identifier: "FailedToSetTagAssignmentsError" }
) {}

/**
 * A merged post is read-only until it is unmerged; tag assignment on it is
 * refused with its own tag (rather than the shared policy denial) so a
 * surface can answer it as the post's state — the Public API maps it to the
 * same merged refusal its PATCH publishes — instead of guessing whether the
 * denial meant a foreign post or a merged one.
 */
export class PostIsMergedError extends Schema.TaggedError<PostIsMergedError>()(
  "PostIsMergedError",
  {},
  { httpApiStatus: 409, identifier: "PostIsMergedError" }
) {}

export const TagServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  BadRequestError,
  FailedToCreateTagError,
  FailedToUpdateTagError,
  FailedToDeleteTagError,
  FailedToSetTagAssignmentsError,
  PostIsMergedError,
]);
