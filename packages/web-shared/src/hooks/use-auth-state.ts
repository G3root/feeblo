import { eq, useLiveQuery } from "@tanstack/react-db";
import { useCallback } from "react";
import {
  AUTH_STATE_KEY,
  type AuthState,
  authClient,
  authStateCollection,
  isAuthStateValid,
  updateAuthState,
} from "../lib/auth-client";

export const useAuthState = () => {
  const { data, isLoading } = useLiveQuery(
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

  const state = data as AuthState | undefined;

  return {
    data: isAuthStateValid(state) ? state : undefined,
    isPending: isLoading,
    refetch,
  };
};
