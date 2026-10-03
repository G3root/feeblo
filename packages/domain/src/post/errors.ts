import * as Schema from "effect/Schema";

import { InvalidSubjectError, SubjectNotFoundError } from "../identity/errors";
import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export class FailedToCreatePostError extends Schema.TaggedError<FailedToCreatePostError>()(
  "FailedToCreatePostError",
  {},
  { httpApiStatus: 500, identifier: "FailedToCreatePostError" }
) {}

export class PostAlreadyExistsError extends Schema.TaggedError<PostAlreadyExistsError>()(
  "PostAlreadyExistsError",
  { message: Schema.optional(Schema.String) },
  { httpApiStatus: 409, identifier: "PostAlreadyExistsError" }
) {}

export class FailedToDeletePostError extends Schema.TaggedError<FailedToDeletePostError>()(
  "FailedToDeletePostError",
  {},
  { httpApiStatus: 500, identifier: "FailedToDeletePostError" }
) {}

/** No post matched the given id/board/organization — nothing was deleted. */
export class PostNotFoundError extends Schema.TaggedError<PostNotFoundError>()(
  "PostNotFoundError",
  { message: Schema.optional(Schema.String) },
  { httpApiStatus: 404, identifier: "PostNotFoundError" }
) {}

export class FailedToUpdatePostError extends Schema.TaggedError<FailedToUpdatePostError>()(
  "FailedToUpdatePostError",
  {},
  { httpApiStatus: 500, identifier: "FailedToUpdatePostError" }
) {}

/**
 * Why a merge or unmerge was refused.
 *
 * The reason travels beside the human message because a caller that maps the
 * failure onto a published error vocabulary needs the state, not the prose:
 * the Public API answers a missing post with `NOT_FOUND` and an archived or
 * already-merged one with `CONFLICT`, and parsing the message to tell them
 * apart would break the moment the wording changed. The dashboard shows the
 * message and ignores this field.
 */
export const FAILED_TO_MERGE_POST_REASONS = [
  "post_not_found",
  "same_post",
  "source_merged",
  "source_archived",
  "target_merged",
  "target_archived",
  "source_has_children",
  "post_not_merged",
] as const;

export type TFailedToMergePostReason =
  (typeof FAILED_TO_MERGE_POST_REASONS)[number];

export class FailedToMergePostError extends Schema.TaggedError<FailedToMergePostError>()(
  "FailedToMergePostError",
  {
    message: Schema.String,
    reason: Schema.Literals(FAILED_TO_MERGE_POST_REASONS),
  },
  { httpApiStatus: 500, identifier: "FailedToMergePostError" }
) {}

export const PostServiceErrors = Schema.Union([
  BadRequestError,
  UnauthorizedError,
  InternalServerError,
  PostAlreadyExistsError,
  PolicyDeniedError,
  PostNotFoundError,
  FailedToCreatePostError,
  FailedToDeletePostError,
  FailedToUpdatePostError,
  FailedToMergePostError,
  // On-behalf creation resolves an author subject and can reject invalid
  // identifiers with the shared identity failures.
  SubjectNotFoundError,
  InvalidSubjectError,
]);
