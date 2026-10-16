import { AllRpcs } from "@feeblo/domain/rpc-group";
import { rpcProtocolFor, rpcRuntimeMemoMap } from "@feeblo/rpc-client";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import type * as Duration from "effect/Duration";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRpc from "effect/reactivity/AtomRpc";

/**
 * Shared Atom RPC client for dashboard queries and mutations.
 *
 * The protocol layer and memo map are the ones the promise runtime (`fetchRpc`)
 * builds from, so both clients speak over one protocol instance: one HTTP
 * client, and one batch queue once the browser batches frames. The same bundle
 * also serves the public board's client when both surfaces load in one app.
 */
export class DashboardClient extends AtomRpc.Service<DashboardClient>()(
  "DashboardClient",
  {
    group: AllRpcs,
    protocol: () => rpcProtocolFor(getRuntimePublicEnv().apiUrl),
    runtime: Atom.context({ memoMap: rpcRuntimeMemoMap }),
  }
) {}

/** Adds active stale-while-revalidate refreshes to dashboard query atoms. */
export const dashboardSWR =
  (staleTime: Duration.Input) =>
  <A, E>(atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>) =>
    Atom.swr(Atom.withRefresh(atom, staleTime), {
      staleTime,
      revalidateOnFocus: "always",
      focusSignal: Atom.windowFocusSignal,
    });
