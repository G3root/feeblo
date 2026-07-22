import { useCallback } from "react";
import { refreshAuthSession } from "../auth/atoms";
import { useAuth } from "../auth/auth-context";

/**
 * Compatibility adapter for existing full-session consumers. New display-only
 * consumers should use `useAuth`; this adapter deliberately withholds an
 * optimistic hint because roles and session metadata must be authoritative.
 */
export const useAuthState = () => {
  const auth = useAuth();

  const refetch = useCallback(async () => {
    await refreshAuthSession();
  }, []);

  return {
    data: auth.status === "authenticated" && auth.data ? auth.data : undefined,
    isPending:
      auth.status === "loading" ||
      (auth.status === "authenticated" && auth.data === null),
    refetch,
  };
};
