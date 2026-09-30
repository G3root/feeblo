import * as Schema from "effect/Schema";

import { InvalidSubjectError, SubjectNotFoundError } from "../identity/errors";
import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export class FailedToDeleteCommentError extends Schema.TaggedError<FailedToDeleteCommentError>()(
  "FailedToDeleteCommentError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 500, identifier: "FailedToDeleteCommentError" }
) {}

export class FailedToUpdateCommentError extends Schema.TaggedError<FailedToUpdateCommentError>()(
  "FailedToUpdateCommentError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 500, identifier: "FailedToUpdateCommentError" }
) {}

export class FailedToCreateCommentError extends Schema.TaggedError<FailedToCreateCommentError>()(
  "FailedToCreateCommentError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 500, identifier: "FailedToCreateCommentError" }
) {}

export class FailedToPinCommentError extends Schema.TaggedError<FailedToPinCommentError>()(
  "FailedToPinCommentError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 500, identifier: "FailedToPinCommentError" }
) {}

export class FailedToUnpinCommentError extends Schema.TaggedError<FailedToUnpinCommentError>()(
  "FailedToUnpinCommentError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 500, identifier: "FailedToUnpinCommentError" }
) {}

/**
 * The post a comment was aimed at stopped accepting comments before the write
 * landed: it was locked, or merged into another post.
 *
 * The caller checks the post's state too, so an ordinary request never sees
 * this — but that check cannot hold the post still, and this one runs inside
 * the write's own transaction under the post row's lock. A conflict rather
 * than a policy denial because it is the resource's state, not the caller's
 * capability.
 */
export class PostDoesNotAcceptCommentsError extends Schema.TaggedError<PostDoesNotAcceptCommentsError>()(
  "PostDoesNotAcceptCommentsError",
  { message: Schema.String },
  { httpApiStatus: 409, identifier: "PostDoesNotAcceptCommentsError" }
) {}

export const CommentServiceErrors = Schema.Union([
  BadRequestError,
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  FailedToDeleteCommentError,
  FailedToUpdateCommentError,
  FailedToCreateCommentError,
  // A create re-checks the post's state inside its own transaction, so a lock
  // or a merge that lands between the caller's check and the write is still
  // refused.
  PostDoesNotAcceptCommentsError,
  // On-behalf creation resolves an author subject and can reject invalid
  // identifiers with the shared identity failures.
  SubjectNotFoundError,
  InvalidSubjectError,
  FailedToPinCommentError,
  FailedToUnpinCommentError,
]);
