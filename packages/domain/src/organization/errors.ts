import { Schema } from "effect";
import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from "../rpc-errors";

export const OrganizationServiceErrors = Schema.Union(
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  NotFoundError,
  BadRequestError
);
