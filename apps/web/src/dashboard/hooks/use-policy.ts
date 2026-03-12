import { type ReactNode, useMemo } from "react";
import { authClient } from "~/lib/auth-client";

type SessionData = NonNullable<
  ReturnType<typeof authClient.useSession>["data"]
>;

export type ClientPolicy = (session: SessionData) => boolean;

export function usePolicy(policy: ClientPolicy): {
  allowed: boolean;
  isPending: boolean;
} {
  const { data: session, isPending } = authClient.useSession();

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
 * Mirrors server Policy.any(hasRole("owner"), hasRole("admin")) used in
 * membership (invite, update role, remove, cancel invitation) and board/post isOwner.
 */
export const hasOwnerOrAdminRole = (): ClientPolicy =>
  anyPolicy(hasRole("owner"), hasRole("admin"));

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
