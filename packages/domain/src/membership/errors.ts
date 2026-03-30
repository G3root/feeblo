import { Schema } from "effect";
import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export const MembershipServiceErrors = Schema.Union(
  UnauthorizedError,
  InternalServerError,
  BadRequestError,
  PolicyDeniedError
);
