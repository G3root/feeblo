/** biome-ignore-all lint/performance/noBarrelFile: intentional package entry point. */
export type { PermissionContext } from "./can";
export {
  can,
  canAll,
  canAny,
  isMember,
  isOwnerOrAdmin,
  roleIn,
} from "./can";
export type { Permission, PermissionDefinition } from "./permissions";
export {
  createPermissions,
  PERMISSION_CATALOG,
  PERMISSIONS,
} from "./permissions";

export {
  isPrivilegedRole,
  permissionsForRole,
  PRIVILEGED_ROLES,
  ROLE_PERMISSIONS,
  roleGrants,
} from "./role-permissions";
export type { InvitableRole, Role } from "./roles";
export {
  compareRoles,
  INVITABLE_ROLES,
  isInvitableRole,
  isRole,
  ROLE_RANK,
  ROLES,
  roleAtLeast,
} from "./roles";
