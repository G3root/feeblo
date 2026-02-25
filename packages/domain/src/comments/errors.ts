import { Schema } from "effect";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

export const CommentServiceErrors = Schema.Union(
  UnauthorizedError,
  InternalServerError
);
