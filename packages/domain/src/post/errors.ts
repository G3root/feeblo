import { Schema } from "effect";
import { PolicyDeniedError } from "../policy";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

export const PostServiceErrors = Schema.Union(
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError
);
