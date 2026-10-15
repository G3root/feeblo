import { AllRpcs } from "@feeblo/domain/rpc-group";
import { rpcProtocolFor, rpcRuntimeMemoMap } from "@feeblo/rpc-client";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRpc from "effect/reactivity/AtomRpc";

/**
 * Shared Atom RPC client for public-board queries.
 *
 * It shares its protocol layer with the promise runtime (`fetchRpc`) the board's
 * collections use, so both speak over one HTTP client and one batch queue.
 */
export class PublicClient extends AtomRpc.Service<PublicClient>()(
  "PublicClient",
  {
    group: AllRpcs,
    protocol: () => rpcProtocolFor(getRuntimePublicEnv().apiUrl),
    runtime: Atom.context({ memoMap: rpcRuntimeMemoMap }),
  }
) {}
