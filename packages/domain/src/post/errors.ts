import { Schema } from "effect";
import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export class FailedToCreatePostError extends Schema.TaggedErrorClass<FailedToCreatePostError>()(
  "FailedToCreatePostError",
  {},
  { httpApiStatus: 500, identifier: "FailedToCreatePostError" }
) {}

export class FailedToDeletePostError extends Schema.TaggedErrorClass<FailedToDeletePostError>()(
  "FailedToDeletePostError",
  {},
  { httpApiStatus: 500, identifier: "FailedToDeletePostError" }
) {}

export class FailedToUpdatePostError extends Schema.TaggedErrorClass<FailedToUpdatePostError>()(
  "FailedToUpdatePostError",
  {},
  { httpApiStatus: 500, identifier: "FailedToUpdatePostError" }
) {}

export class FailedToMergePostError extends Schema.TaggedErrorClass<FailedToMergePostError>()(
  "FailedToMergePostError",
  { message: Schema.String },
  { httpApiStatus: 500, identifier: "FailedToMergePostError" }
) {}

export const PostServiceErrors = Schema.Union([
  BadRequestError,
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  FailedToCreatePostError,
  FailedToDeletePostError,
  FailedToUpdatePostError,
  FailedToMergePostError,
]);
