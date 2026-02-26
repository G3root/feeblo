import { Schema } from "effect";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

export const SiteServiceErrors = Schema.Union(
  UnauthorizedError,
  InternalServerError
);
