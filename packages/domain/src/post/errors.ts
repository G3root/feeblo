import { HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";
import { PolicyDeniedError } from "../policy";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

export class FailedToCreatePostError extends Schema.TaggedError<FailedToCreatePostError>()(
  "FailedToCreatePostError",
  {},
  HttpApiSchema.annotations({
    status: 500,
    identifier: "FailedToCreatePostError",
  })
) {}

export class FailedToDeletePostError extends Schema.TaggedError<FailedToDeletePostError>()(
  "FailedToDeletePostError",
  {},
  HttpApiSchema.annotations({
    status: 500,
    identifier: "FailedToDeletePostError",
  })
) {}

export class FailedToUpdatePostError extends Schema.TaggedError<FailedToUpdatePostError>()(
  "FailedToUpdatePostError",
  {},
  HttpApiSchema.annotations({
    status: 500,
    identifier: "FailedToUpdatePostError",
  })
) {}

export const PostServiceErrors = Schema.Union(
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  FailedToCreatePostError,
  FailedToDeletePostError,
  FailedToUpdatePostError
);
