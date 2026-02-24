import { Schema } from "effect";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

export const PostServiceErrors = Schema.Union(
  UnauthorizedError,
  InternalServerError
);
