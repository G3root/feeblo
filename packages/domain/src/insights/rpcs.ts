import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { AuthMiddleware } from "../session-middleware";
import { InsightsServiceErrors } from "./errors";
import { InsightsPayload, WorkspaceInsights } from "./schema";

/**
 * The dashboard's insights surface.
 *
 * One operation, not one per metric: the page renders every number together,
 * and a per-metric operation would make the page's cost the sum of its
 * round trips. It is dashboard-only — the Public API's aggregate surface is a
 * separate contract and deliberately not this one (see `docs/adr/0004`).
 */
export class InsightsRpcs extends RpcGroup.make(
  Rpc.make("GetWorkspaceInsights", {
    success: WorkspaceInsights,
    payload: InsightsPayload,
    error: InsightsServiceErrors,
  }).middleware(AuthMiddleware)
) {}
