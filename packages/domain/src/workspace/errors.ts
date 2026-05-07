import { Schema } from "effect";
import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export class FailedToCreateWorkspaceError extends Schema.TaggedErrorClass<FailedToCreateWorkspaceError>()(
  "FailedToCreateWorkspaceError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 500, identifier: "FailedToCreateWorkspaceError" }
) {}

export const WorkspaceServiceErrors = Schema.Union([
  UnauthorizedError,
  BadRequestError,
  InternalServerError,
  PolicyDeniedError,
  FailedToCreateWorkspaceError,
]);
