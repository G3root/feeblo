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

export const CommentServiceErrors = Schema.Union([
  BadRequestError,
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  FailedToDeleteCommentError,
  FailedToUpdateCommentError,
  FailedToCreateCommentError,
  // On-behalf creation resolves an author subject and can reject invalid
  // identifiers with the shared identity failures.
  SubjectNotFoundError,
  InvalidSubjectError,
  FailedToPinCommentError,
  FailedToUnpinCommentError,
]);
