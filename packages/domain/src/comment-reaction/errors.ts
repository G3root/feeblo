import { Schema } from "effect";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

export const CommentReactionServiceErrors = Schema.Union(
  UnauthorizedError,
  InternalServerError
);
