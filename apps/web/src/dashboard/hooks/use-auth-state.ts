import { eq, useLiveQuery } from "@tanstack/react-db";
import { useCallback } from "react";
import {
  AUTH_STATE_KEY,
  authClient,
  authStateCollection,
  updateAuthState,
} from "~/lib/auth-client";

export const useAuthState = () => {
  const { data } = useLiveQuery(
    (q) =>
      q
        .from({ auth: authStateCollection })
        .where(({ auth }) => eq(auth.id, AUTH_STATE_KEY))
        .findOne(),
    []
  );

  const refetch = useCallback(async () => {
    const result = await authClient.getSession();
    if (result.data) {
      updateAuthState(result.data);
    }
  }, []);

  return { data, refetch };
};
