import type { Permission } from "./permissions";
import { isRole, ROLE_RANK, ROLES, type Role } from "./roles";

/**
 * Base grants per role. Roles inherit every permission of lower-ranked roles
 * (owner ⊃ admin ⊃ manager ⊃ contributor) — the inheritance is applied by
 * `permissionsForRole`/`roleGrants`, so each entry here only lists the grants
 *added* at that level.
 *
 * Keep this table in sync with the backend `*Policy` services; it is the
 * single definition shared by backend enforcement and frontend UI gating.
 */
export const ROLE_PERMISSIONS = {
  /**
   * Contributors are otherwise governed by membership- and ownership-scoped
   * content policies. Moving posts is intentionally available across posts.
   * Voting on behalf of another user is the documented all-role capability,
   * so `votes.onBehalf` starts here and every higher role inherits it.
   */
  contributor: ["posts.move", "votes.onBehalf"],
  /**
   * Managers (formerly "member") run day-to-day feedback operations:
   * moderation, changelogs, tags, roadmaps, and user cleanup. CRM
   * creation/update stays manager-scoped. `posts.*` includes
   * `posts.createOnBehalf` (attributing posts to customers); contributor's
   * scoped grants deliberately do not.
   */
  manager: [
    "members.remove",
    "posts.*",
    "changelog.*",
    "changelog-categories.*",
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
    "workspace.delete",
    "members.*",
    "billing.*",
    "site.*",
    "boards.*",
    "contacts.*",
    "companies.*",
    "webhooks.manage",
    "integrations.manage",
  ],
  // Owner is retained for legacy workspaces. It intentionally adds no grants:
  // owner and admin have the same effective permissions.
  owner: [],
} satisfies Record<Role, readonly Permission[]>;

/** Every permission granted to `role`, including inherited ones. */
export const permissionsForRole = (role: Role): ReadonlySet<Permission> => {
  const permissions = new Set<Permission>();
  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
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

  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  return grants.has(`${permission.slice(0, separator)}.*` as Permission);
};

/**
 * Privileged roles — the roles that can manage a workspace. Derived from the
 * permission table via the `workspace.update` grant (admin directly, owner by
 * inheritance) instead of a hardcoded role list, so a role's privilege level
 * always follows its grants. Mirrors `hasOwnerOrAdminRole` on the frontend,
 * which gates on the same permission.
 */
export const PRIVILEGED_ROLES =
  /* SAFETY: the filtered items are members of ROLES, hence branded Role values. */
  ROLES.filter((role) =>
    roleGrants(role, "workspace.update")
  ) as readonly Role[];

/** True when `role` is "owner" or "admin" — i.e. grants `workspace.update`. */
export const isPrivilegedRole = (role: string): boolean =>
  isRole(role) && roleGrants(role, "workspace.update");
