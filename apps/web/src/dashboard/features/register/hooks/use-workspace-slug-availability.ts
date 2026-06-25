import { useEffect, useState } from "react";
import { authClient } from "~/lib/auth-client";

type SlugStatus = "idle" | "checking" | "available" | "taken" | "error";

export function useWorkspaceSlugAvailability(slug: string, enabled: boolean) {
  const [status, setStatus] = useState<SlugStatus>("idle");

  useEffect(() => {
    if (!(enabled && slug)) {
      setStatus("idle");
      return;
    }

    let cancelled = false;

    const timeoutId = window.setTimeout(async () => {
      setStatus("checking");

      try {
        const response = await authClient.organization.checkSlug({ slug });

        if (cancelled) {
          return;
        }

        setStatus(response.error ? "taken" : "available");
      } catch {
        if (!cancelled) {
          setStatus("error");
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [slug, enabled]);

  return status;
}
