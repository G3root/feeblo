import type { Permission } from "./permissions";
import { roleGrants } from "./role-permissions";
import type { Role } from "./roles";

/**
 * The minimal session shape `can()` needs. Both the backend authenticated
 * session (`packages/domain/src/session-middleware.ts#Session`) and the
 * frontend auth client session (`packages/auth/src/auth-client.ts#
 * AuthClientSession`) are structurally compatible with this type, so the same
 * pure function runs on the server and in the browser without drift.
 */
export type PermissionContext = {
  readonly memberships: readonly Readonly<{
    readonly organizationId: string;
    readonly role: Role;
  }>[];
};

/**
 * Core API — the single `can()` used by backend enforcement and frontend UI
 * gating:
 *
 *   backend:  Policy.canPermission(organizationId, permission)
 *   frontend: hasPermission(organizationId, permission)
 *
 * both delegate to this function.
 */
export const can = (
  context: PermissionContext | null | undefined,
  organizationId: string,
  permission: Permission
): boolean => {
  if (!context) {
    return false;
  }
  const membership = context.memberships.find(
    (membership) => membership.organizationId === organizationId
  );
  return membership != null && roleGrants(membership.role, permission);
};

/** True when the context grants ANY of the given permissions in the org. */
export const canAny = (
  context: PermissionContext | null | undefined,
  organizationId: string,
  permissions: readonly Permission[]
): boolean =>
  permissions.some((permission) => can(context, organizationId, permission));

/** True when the context grants ALL of the given permissions in the org. */
export const canAll = (
  context: PermissionContext | null | undefined,
  organizationId: string,
  permissions: readonly Permission[]
): boolean =>
  permissions.every((permission) => can(context, organizationId, permission));

/** The actor's role in the org, or undefined when not a member. */
export const roleIn = (
  context: PermissionContext | null | undefined,
  organizationId: string
): Role | undefined =>
  context?.memberships.find(
    (membership) => membership.organizationId === organizationId
  )?.role;

/** True when the context has any membership in the org. */
export const isMember = (
  context: PermissionContext | null | undefined,
  organizationId: string
): boolean => roleIn(context, organizationId) !== undefined;

/**
 * True when the context holds a privileged role (owner/admin) in the org.
 * Semantic replacement for the old `role === "owner" || role === "admin"`
 * checks; equivalent to `can(context, orgId, "workspace.update")`.
 */
export const isOwnerOrAdmin = (
  context: PermissionContext | null | undefined,
  organizationId: string
): boolean => can(context, organizationId, "workspace.update");
