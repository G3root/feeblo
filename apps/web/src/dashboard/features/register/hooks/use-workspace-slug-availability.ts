import { useEffect, useState } from "react";

import { fetchRpc } from "~/lib/runtime";

type SlugStatus = "idle" | "checking" | "available" | "taken" | "error";

interface SlugAvailabilityState {
  status: SlugStatus;
  suggestion: string | null;
}

export function useWorkspaceSlugAvailability(slug: string, enabled: boolean) {
  const [state, setState] = useState<SlugAvailabilityState>({
    status: "idle",
    suggestion: null,
  });

  useEffect(() => {
    if (!(enabled && slug)) {
      setState({ status: "idle", suggestion: null });
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const timeoutId = window.setTimeout(async () => {
      setState({ status: "checking", suggestion: null });

      try {
        const response = await fetchRpc(
          (rpc) => rpc.WorkspaceSlugCheck({ slug }),
          { signal: controller.signal }
        );

        if (cancelled) {
          return;
        }

        if (response.available) {
          setState({ status: "available", suggestion: null });
        } else {
          setState({ status: "taken", suggestion: response.suggestion });
        }
      } catch {
        // Aborted superseded checks stay silent; only genuine failures
        // surface, and never after unmount.
        if (!cancelled && !controller.signal.aborted) {
          setState({ status: "error", suggestion: null });
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [slug, enabled]);

  return state;
}
