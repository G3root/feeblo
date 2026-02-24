import { Schema } from "effect";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

export const MembershipServiceErrors = Schema.Union(
  UnauthorizedError,
  InternalServerError
);
