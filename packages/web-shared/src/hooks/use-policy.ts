import { type ReactNode, useMemo } from "react";
import type { ValidAuthState } from "../lib/auth-client";
import { useAuthState } from "./use-auth-state";

type SessionData = ValidAuthState;

export type ClientPolicy = (session: SessionData) => boolean;

export function usePolicy(policy: ClientPolicy): {
  allowed: boolean;
  isPending: boolean;
} {
  const { data: session, isPending } = useAuthState();

  const allowed = useMemo(() => {
    if (!session) {
      return false;
    }
    return policy(session);
  }, [session, policy]);

  return { allowed, isPending };
}

/**
 * Creates a client-side policy from a predicate on the session.
 * Frontend mirror of `packages/domain/src/policy.ts#policy`.
 */
export const policy = (
  predicate: (session: SessionData) => boolean
): ClientPolicy => predicate;

export const hasMembership = (organizationId: string): ClientPolicy =>
  policy((session) =>
    session.memberships.some((m) => m.organizationId === organizationId)
  );

export const hasRole = (role: "owner" | "admin" | "member"): ClientPolicy =>
  policy((session) => session.memberships.some((m) => m.role === role));

export const isUser = (userId: string): ClientPolicy =>
  policy((session) => session.user.id === userId);

export const allPolicy = (
  ...policies: [ClientPolicy, ...ClientPolicy[]]
): ClientPolicy => policy((session) => policies.every((p) => p(session)));

export const anyPolicy = (
  ...policies: [ClientPolicy, ...ClientPolicy[]]
): ClientPolicy => policy((session) => policies.some((p) => p(session)));

/**
 * Client policy: current user is organization owner or admin.
 * When an organization id is provided, the role must belong to that organization.
 */
export const hasOwnerOrAdminRole = (organizationId?: string): ClientPolicy => {
  if (!organizationId) {
    return anyPolicy(hasRole("owner"), hasRole("admin"));
  }

  return policy((session) =>
    session.memberships.some(
      (membership) =>
        membership.organizationId === organizationId &&
        (membership.role === "owner" || membership.role === "admin")
    )
  );
};

/**
 * Conditionally renders children based on a policy evaluation.
 * Frontend mirror of `withPolicy` from `packages/domain/src/policy.ts`.
 */
export function PolicyGuard({
  policy,
  fallback = null,
  pending = null,
  children,
}: {
  policy: ClientPolicy;
  fallback?: ReactNode;
  pending?: ReactNode;
  children: ReactNode;
}): ReactNode {
  const { allowed, isPending } = usePolicy(policy);

  if (isPending) {
    return pending;
  }

  if (!allowed) {
    return fallback;
  }

  return children;
}
