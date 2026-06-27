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

    const timeoutId = window.setTimeout(async () => {
      setState({ status: "checking", suggestion: null });

      try {
        const response = await fetchRpc((rpc) =>
          rpc.WorkspaceSlugCheck({ slug })
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
        if (!cancelled) {
          setState({ status: "error", suggestion: null });
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [slug, enabled]);

  return state;
}
