import type { Permission } from "./permissions";
import type { Role } from "./roles";

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
   * Contributors feed the funnel: they submit, vote on, and discuss feedback.
   * They cannot create boards, changelogs, tags, or CRM records.
   */
  contributor: [
    "members.view",
    "posts.create",
    "posts.vote",
    "posts.comment",
    "notifications.manage",
  ],
  /**
   * Managers (formerly "member") run day-to-day content operations: boards,
   * changelogs, tags, and non-destructive CRM work.
   */
  manager: [
    "boards.create",
    "changelog.create",
    "tags.create",
    "contacts.create",
    "contacts.update",
    "companies.create",
    "companies.update",
  ],
  admin: [
    "workspace.manage",
    "members.invite",
    "members.remove",
    "members.roles.assign",
    "billing.manage",
    "site.manage",
    "site.customize",
    "boards.manage",
    "posts.manage",
    "posts.moderate",
    "changelog.manage",
    "roadmap.manage",
    "tags.manage",
    "contacts.manage",
    "contacts.attributes.manage",
    "companies.manage",
    "companies.attributes.manage",
  ],
  owner: ["workspace.delete", "members.roles.owner"],
};

const ROLE_RANK: Record<Role, number> = {
  contributor: 0,
  manager: 1,
  admin: 2,
  owner: 3,
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

/** True when `role` grants `permission` (directly or through inheritance). */
export const roleGrants = (role: Role, permission: Permission): boolean =>
  permissionsForRole(role).has(permission);
