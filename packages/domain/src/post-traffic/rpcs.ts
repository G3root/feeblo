import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { AuthMiddleware } from "../session-middleware";
import { PostTrafficServiceErrors } from "./errors";
import { PostTraffic, PostTrafficPayload } from "./schema";

/**
 * The dashboard's per-post traffic read.
 *
 * One operation, because the sidebar needs the number and its breakdowns
 * together and a separate call per dimension would make a small panel the sum
 * of four round trips. It is dashboard-only: the public board never renders a
 * count, and a Public API projection is a separate contract (ADR 0004).
 */
export class PostTrafficRpcs extends RpcGroup.make(
  Rpc.make("GetPostTraffic", {
    success: PostTraffic,
    payload: PostTrafficPayload,
    error: PostTrafficServiceErrors,
  }).middleware(AuthMiddleware)
) {}
