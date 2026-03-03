import { Schema } from "effect";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export const OnboardingServiceErrors = Schema.Union(
  UnauthorizedError,
  BadRequestError,
  InternalServerError
);
