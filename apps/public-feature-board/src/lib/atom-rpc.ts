import { AllRpcs } from "@feeblo/domain/rpc-group";
import { createRpcProtocolLive } from "@feeblo/rpc-client";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import * as AtomRpc from "effect/unstable/reactivity/AtomRpc";

/** Shared Atom RPC client for public-board queries. */
export class PublicClient extends AtomRpc.Service<PublicClient>()(
  "PublicClient",
  {
    group: AllRpcs,
    protocol: () => createRpcProtocolLive(getRuntimePublicEnv().apiUrl),
  }
) {}
