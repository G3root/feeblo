import { Schema } from "effect";
import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export const WorkspaceServiceErrors = Schema.Union(
  UnauthorizedError,
  BadRequestError,
  InternalServerError,
  PolicyDeniedError
);
