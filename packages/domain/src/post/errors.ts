import { HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";
import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

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

export class FailedToMergePostError extends Schema.TaggedError<FailedToMergePostError>()(
  "FailedToMergePostError",
  {},
  HttpApiSchema.annotations({
    status: 500,
    identifier: "FailedToMergePostError",
  })
) {}

export const PostServiceErrors = Schema.Union(
  BadRequestError,
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  FailedToCreatePostError,
  FailedToDeletePostError,
  FailedToUpdatePostError,
  FailedToMergePostError
);
