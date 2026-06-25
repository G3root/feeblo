import { Schema } from "effect";
import { PolicyDeniedError } from "../policy";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

export class FailedToDeleteCommentError extends Schema.TaggedErrorClass<FailedToDeleteCommentError>()(
  "FailedToDeleteCommentError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 500, identifier: "FailedToDeleteCommentError" }
) {}

export class FailedToUpdateCommentError extends Schema.TaggedErrorClass<FailedToUpdateCommentError>()(
  "FailedToUpdateCommentError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 500, identifier: "FailedToUpdateCommentError" }
) {}

export class FailedToCreateCommentError extends Schema.TaggedErrorClass<FailedToCreateCommentError>()(
  "FailedToCreateCommentError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 500, identifier: "FailedToCreateCommentError" }
) {}

export const CommentServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  FailedToDeleteCommentError,
  FailedToUpdateCommentError,
  FailedToCreateCommentError,
]);
