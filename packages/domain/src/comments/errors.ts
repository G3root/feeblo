import { HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

export class FailedToDeleteCommentError extends Schema.TaggedError<FailedToDeleteCommentError>()(
  "FailedToDeleteCommentError",
  {
    message: Schema.optional(Schema.String),
  },
  HttpApiSchema.annotations({
    status: 500,
    identifier: "FailedToDeleteCommentError",
  })
) {}

export class FailedToUpdateCommentError extends Schema.TaggedError<FailedToUpdateCommentError>()(
  "FailedToUpdateCommentError",
  {
    message: Schema.optional(Schema.String),
  },
  HttpApiSchema.annotations({
    status: 500,
    identifier: "FailedToUpdateCommentError",
  })
) {}

export class FailedToCreateCommentError extends Schema.TaggedError<FailedToCreateCommentError>()(
  "FailedToCreateCommentError",
  {
    message: Schema.optional(Schema.String),
  },
  HttpApiSchema.annotations({
    status: 500,
    identifier: "FailedToCreateCommentError",
  })
) {}

export const CommentServiceErrors = Schema.Union(
  UnauthorizedError,
  InternalServerError,
  FailedToDeleteCommentError
);
