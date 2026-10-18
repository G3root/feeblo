import * as S from "effect/Schema";

import { PlanLockedError } from "../entitlement/errors";
import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export const RoadmapServiceErrors = S.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  PlanLockedError,
  BadRequestError,
]);
