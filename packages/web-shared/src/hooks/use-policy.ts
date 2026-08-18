import { isFunction } from "@feeblo/utils/runtime-kind";
import type { AuthClientSession } from "@feeblo/auth/client";
import type { Permission, Role } from "@feeblo/permissions";
import { can, isMember, roleIn } from "@feeblo/permissions";
import { type ReactNode, useMemo } from "react";

import { useAuthState } from "./use-auth-state";

type SessionData = AuthClientSession;

export type ClientPolicy = (session: SessionData) => boolean;

export type PolicyEvaluation = {
  allowed: boolean;
  isPending: boolean;
};

export function usePolicy(policy: ClientPolicy): PolicyEvaluation {
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

/**
 * Client-side gate for a named permission. Delegates to the shared
 * `@feeblo/permissions` table — the exact same `can()` the backend enforces
 * through `packages/domain/src/policy.ts#canPermission` — so UI gating and
 * backend enforcement can never drift.
 */
export const hasPermission = (
  organizationId: string,
  permission: Permission
): ClientPolicy =>
  policy((session) => can(session, organizationId, permission));

export const hasMembership = (organizationId: string): ClientPolicy =>
  policy((session) => isMember(session, organizationId));

/**
 * Org-scoped role check. Unlike the old unscoped `hasRole`, this never leaks
 * roles from other organizations: a user who is admin in org A must not see
 * admin UI in org B.
 */
export const hasRole = (organizationId: string, role: Role): ClientPolicy =>
  policy((session) => roleIn(session, organizationId) === role);

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
 * Delegates to the shared `workspace.update` permission.
 */
export const hasOwnerOrAdminRole = (organizationId: string): ClientPolicy =>
  hasPermission(organizationId, "workspace.update");

/**
 * Conditionally renders children based on a policy evaluation.
 * Frontend mirror of `withPolicy` from `packages/domain/src/policy.ts`.
 *
 * Pass a render prop to render an action in a disabled state instead of
 * hiding it (delete buttons, action menu items, etc.):
 *
 * ```tsx
 * <PolicyGuard policy={hasPermission(organizationId, "boards.delete")}>
 *   {({ allowed }) => (
 *     <MenuItem disabled={!allowed} onClick={handleDelete}>Delete</MenuItem>
 *   )}
 * </PolicyGuard>
 * ```
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
  children: ReactNode | ((result: { allowed: boolean }) => ReactNode);
}): ReactNode {
  const { allowed, isPending } = usePolicy(policy);

  if (isFunction(children)) {
    // SAFETY: the union branch narrowed by isFunction is the render-function
    // form of children.
    const renderChildren = children as (
      result: { allowed: boolean }
    ) => ReactNode;
    if (isPending) {
      return renderChildren({ allowed: false });
    }
    return renderChildren({ allowed });
  }

  if (isPending) {
    return pending;
  }

  if (!allowed) {
    return fallback;
  }

  return children;
}
