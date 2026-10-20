import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";
import { AuthMiddleware } from "../session-middleware";
import { PlanComplianceInput, WorkspacePlanCompliance } from "./schema";

export const PlanComplianceServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
]);

export class PlanComplianceRpcs extends RpcGroup.make(
  Rpc.make("GetWorkspacePlanCompliance", {
    payload: PlanComplianceInput,
    success: WorkspacePlanCompliance,
    error: PlanComplianceServiceErrors,
  }).middleware(AuthMiddleware)
) {}
