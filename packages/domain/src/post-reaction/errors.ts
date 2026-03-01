import { Schema } from "effect";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

export const PostReactionServiceErrors = Schema.Union(
  UnauthorizedError,
  InternalServerError
);
