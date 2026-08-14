import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { AuthMiddleware } from "../../session-middleware";
import { WebhookManagementErrors } from "../errors";
import * as S from "./schema";

/** Generic authenticated read surface for links from a Feeblo post to provider resources. */
export class ExternalResourceRpcs extends RpcGroup.make(
  Rpc.make("PostExternalResourceLinkList", {
    success: Schema.Array(S.PostExternalResourceLink),
    payload: S.PostExternalResourceLinkList,
    error: WebhookManagementErrors,
  }).middleware(AuthMiddleware)
) {}
