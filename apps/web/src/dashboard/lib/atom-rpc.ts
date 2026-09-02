import { AllRpcs } from "@feeblo/domain/rpc-group";
import { createRpcProtocolLive } from "@feeblo/rpc-client";
import { isString } from "@feeblo/utils/runtime-kind";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import type * as Duration from "effect/Duration";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRpc from "effect/unstable/reactivity/AtomRpc";

/** Shared Atom RPC client for dashboard queries and mutations. */
export class DashboardClient extends AtomRpc.Service<DashboardClient>()(
  "DashboardClient",
  {
    group: AllRpcs,
    protocol: () => {
      const apiUrl = getRuntimePublicEnv().apiUrl;
      if (!isString(apiUrl) || apiUrl.length === 0) {
        throw new Error("API_URL is not configured");
      }
      return createRpcProtocolLive(apiUrl);
    },
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
