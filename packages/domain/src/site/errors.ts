import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import {
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from "../rpc-errors";

export const SiteServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  NotFoundError,
  PolicyDeniedError,
]);
