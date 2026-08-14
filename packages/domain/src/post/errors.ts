import * as Schema from "effect/Schema";

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

export class FailedToUpdatePostError extends Schema.TaggedError<FailedToUpdatePostError>()(
  "FailedToUpdatePostError",
  {},
  { httpApiStatus: 500, identifier: "FailedToUpdatePostError" }
) {}

export class FailedToMergePostError extends Schema.TaggedError<FailedToMergePostError>()(
  "FailedToMergePostError",
  { message: Schema.String },
  { httpApiStatus: 500, identifier: "FailedToMergePostError" }
) {}

export const PostServiceErrors = Schema.Union([
  BadRequestError,
  UnauthorizedError,
  InternalServerError,
  PostAlreadyExistsError,
  PolicyDeniedError,
  FailedToCreatePostError,
  FailedToDeletePostError,
  FailedToUpdatePostError,
  FailedToMergePostError,
]);
