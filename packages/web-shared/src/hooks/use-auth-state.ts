import { useCallback } from "react";
import { refreshAuthSession } from "../auth/atoms";
import { useAuth } from "../auth/auth-context";

type RefreshAuthSession = typeof refreshAuthSession;

export type AuthStateResult =
  | {
      readonly status: "pending";
      readonly data: undefined;
      readonly isPending: true;
      readonly refetch: RefreshAuthSession;
    }
  | {
      readonly status: "unauthenticated";
      readonly data: null;
      readonly isPending: false;
      readonly refetch: RefreshAuthSession;
    }
  | {
      readonly status: "authenticated";
      readonly data: NonNullable<Awaited<ReturnType<RefreshAuthSession>>>;
      readonly isPending: false;
      readonly refetch: RefreshAuthSession;
    };

/**
 * Compatibility adapter for existing full-session consumers. New display-only
 * consumers should use `useAuth`; this adapter deliberately withholds an
 * optimistic hint because roles and session metadata must be authoritative.
 */
export const useAuthState = (): AuthStateResult => {
  const auth = useAuth();

  const refetch = useCallback<RefreshAuthSession>(refreshAuthSession, []);

  if (auth.status === "authenticated" && auth.data) {
    return {
      status: "authenticated",
      data: auth.data,
      isPending: false,
      refetch,
    };
  }

  if (auth.status === "unauthenticated") {
    return {
      status: "unauthenticated",
      data: null,
      isPending: false,
      refetch,
    };
  }

  return {
    status: "pending",
    data: undefined,
    isPending: true,
    refetch,
  };
};
