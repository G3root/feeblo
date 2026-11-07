import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

export const InsightsServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
]);
