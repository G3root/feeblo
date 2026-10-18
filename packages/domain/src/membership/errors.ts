import * as Schema from "effect/Schema";

import { PlanLockedError } from "../entitlement/errors";
import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export const MembershipServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  BadRequestError,
  PolicyDeniedError,
  PlanLockedError,
]);
