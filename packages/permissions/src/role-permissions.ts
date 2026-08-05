import type { Permission } from "./permissions";
import { ROLE_RANK, type Role } from "./roles";

/**
 * Base grants per role. Roles inherit every permission of lower-ranked roles
 * (owner ⊃ admin ⊃ manager ⊃ contributor) — the inheritance is applied by
 * `permissionsForRole`/`roleGrants`, so each entry here only lists the grants
 *added* at that level.
 *
 * Keep this table in sync with the backend `*Policy` services; it is the
 * single definition shared by backend enforcement and frontend UI gating.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  /**
   * Contributors are governed by membership-scoped content policies. They
   * have no additional named permissions.
   */
  contributor: [],
  /**
   * Managers (formerly "member") run day-to-day feedback operations:
   * moderation, changelogs, tags, roadmaps, and user cleanup. CRM
   * creation/update stays manager-scoped.
   */
  manager: [
    "members.remove",
    "posts.*",
    "changelog.*",
    "tags.*",
    "roadmap.*",
    "comments.*",
    "contacts.create",
    "contacts.update",
    "companies.create",
    "companies.update",
  ],
  admin: [
    "workspace.update",
    "members.*",
    "billing.*",
    "site.*",
    "boards.*",
    "contacts.*",
    "companies.*",
  ],
  owner: ["workspace.delete"],
};

/** Every permission granted to `role`, including inherited ones. */
export const permissionsForRole = (role: Role): ReadonlySet<Permission> => {
  const permissions = new Set<Permission>();
  for (const [candidate, rank] of Object.entries(ROLE_RANK) as [
    Role,
    number,
  ][]) {
    if (rank <= ROLE_RANK[role]) {
      for (const permission of ROLE_PERMISSIONS[candidate]) {
        permissions.add(permission);
      }
    }
  }
  return permissions;
};

/** True when `role` grants `permission` directly or through a resource wildcard. */
export const roleGrants = (role: Role, permission: Permission): boolean => {
  const grants = permissionsForRole(role);
  if (grants.has(permission)) {
    return true;
  }

  const separator = permission.indexOf(".");
  if (separator === -1 || permission.endsWith(".*")) {
    return false;
  }

  return grants.has(`${permission.slice(0, separator)}.*` as Permission);
};
