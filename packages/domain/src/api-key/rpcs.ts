import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { AuthMiddleware } from "../session-middleware";
import { ApiKeyServiceErrors } from "./errors";
import {
  ApiKeyCreate,
  ApiKeyCreated,
  ApiKeyList,
  ApiKeyRevoke,
  ApiKeySummary,
} from "./schema";

/**
 * Dashboard API-key management. These RPCs are the only way an API key is
 * created or revoked; the api-key plugin's own HTTP endpoints stay mounted but
 * are gated by the organization ACL, so a role without `apiKeys.manage` cannot
 * bypass these handlers.
 */
export class ApiKeyRpcs extends RpcGroup.make(
  Rpc.make("ApiKeyCreate", {
    success: ApiKeyCreated,
    payload: ApiKeyCreate,
    error: ApiKeyServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ApiKeyList", {
    success: Schema.Array(ApiKeySummary),
    payload: ApiKeyList,
    error: ApiKeyServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ApiKeyRevoke", {
    success: Schema.Void,
    payload: ApiKeyRevoke,
    error: ApiKeyServiceErrors,
  }).middleware(AuthMiddleware)
) {}
