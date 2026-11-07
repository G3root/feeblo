import { toastManager } from "@feeblo/ui/toast";
import { useMachine } from "@xstate/react";
import { useCallback, useEffect, useRef } from "react";

import {
  providerConnectMachine,
  type ProviderConnectStatus,
  toProviderConnectStatus,
} from "../lib/provider-connect-machine";

/** What a provider's connect button needs from this hook. */
export type ProviderConnect = {
  readonly status: ProviderConnectStatus;
  /** Requests an authorize URL and, on success, leaves for the provider. */
  readonly connect: () => void;
};

/**
 * Drives the connect flow the three provider settings pages share.
 *
 * The lifecycle lives in `provider-connect-machine.ts`; this hook is the
 * adapter between the click, the mutation, and the browser navigation. The
 * request is not an `invoke` child because its failure has to be toasted
 * wherever the error is known — here — and because the machine does not need
 * the URL, only the fact that there is one.
 *
 * `authorize` must be stable across renders (`useCallback`): `useMachine` uses
 * the logic from the first render for the hook's lifetime, so this hook holds
 * no machine of its own and the callback is captured per click rather than
 * frozen at mount.
 */
export function useProviderConnect({
  authorize,
  failureTitle,
}: {
  readonly authorize: () => Promise<{ readonly authorizeUrl: URL }>;
  readonly failureTitle: string;
}): ProviderConnect {
  const [snapshot, send] = useMachine(providerConnectMachine);

  // A response that arrives after the settings page unmounted must not
  // navigate: the actor is stopped with the component, and `location.assign`
  // would leave from wherever the user went instead. The cleanup clears this
  // so the pending request learns it has no page left to act on.
  const isActive = useRef(true);
  useEffect(() => {
    isActive.current = true;
    return () => {
      isActive.current = false;
    };
  }, []);

  const connect = useCallback(() => {
    send({ type: "REQUEST" });
    void (async () => {
      let authorizeUrl: URL;
      try {
        ({ authorizeUrl } = await authorize());
      } catch {
        toastManager.add({ title: failureTitle, type: "error" });
        send({ type: "FAILED" });
        return;
      }
      // Checked after the await, because the request can outlive the page that
      // started it.
      if (!isActive.current) {
        return;
      }
      // Announced before the navigation so the actor is already in
      // `redirecting` if the browser refuses to leave; the state's timeout is
      // what brings the button back.
      send({ type: "AUTHORIZED" });
      window.location.assign(authorizeUrl.toString());
    })();
  }, [authorize, failureTitle, send]);

  return { status: toProviderConnectStatus(snapshot), connect };
}
