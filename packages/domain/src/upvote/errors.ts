import { Schema } from "effect";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

export const UpvoteServiceErrors = Schema.Union(
  UnauthorizedError,
  InternalServerError
);
