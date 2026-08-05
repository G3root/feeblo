/**
 * Organization roles — the single source of truth for the role hierarchy.
 *
 * Both the backend (`packages/domain`) and the frontend (`packages/web-shared`,
 * `apps/web`) must reference this module instead of hardcoding role literals.
 *
 * Modeled after Featurebase/Canny: a strict role hierarchy where higher roles
 * inherit the permissions of every lower role:
 *
 *   owner > admin > manager > contributor
 *
 * - `owner`       — full workspace control, created with the workspace.
 * - `admin`       — privileged: manages members, billing, site, roadmap,
 *                   content moderation, and everything below.
 * - `manager`     — content manager: creates boards, changelogs, tags, and
 *                   CRM records (formerly the "member" role).
 * - `contributor` — contributes feedback: creates/votes/comments on posts.
 */
export const ROLES = ["owner", "admin", "manager", "contributor"] as const;

export type Role = (typeof ROLES)[number];

/**
 * Higher rank = more authority. Used for hierarchy comparisons
 * (`roleAtLeast`) and for member-management rank rules (an actor may only
 * manage targets with a strictly lower rank).
 */
export const ROLE_RANK: Record<Role, number> = {
  contributor: 0,
  manager: 1,
  admin: 2,
  owner: 3,
};

/**
 * Privileged roles — the roles that can manage a workspace. Equivalent to the
 * ad-hoc `role === "owner" || role === "admin"` checks that used to be
 * scattered across the codebase.
 */
export const PRIVILEGED_ROLES = [
  "owner",
  "admin",
] as const satisfies readonly Role[];

/**
 * Roles that can be granted via an invitation. Owners are never invited — the
 * owner role is created when the workspace is created (Featurebase/Canny
 * behave the same way).
 */
export const INVITABLE_ROLES = [
  "admin",
  "manager",
  "contributor",
] as const satisfies readonly Role[];

export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const isRole = (value: unknown): value is Role =>
  typeof value === "string" && (ROLES as readonly string[]).includes(value);

/** True when `role` is "owner" or "admin". */
export const isPrivilegedRole = (role: unknown): boolean =>
  role === "owner" || role === "admin";

/** True when `role` is a role that can be granted through an invitation. */
export const isInvitablerole = (role: unknown): boolean =>
  role === "admin" || role === "manager" || role === "contributor";

/**
 * True when `role` sits at or above `minimum` in the hierarchy.
 * `roleAtLeast("owner", "admin")` is true; `roleAtLeast("contributor",
 * "manager")` is false.
 */
export const roleAtLeast = (role: Role, minimum: Role): boolean =>
  ROLE_RANK[role] >= ROLE_RANK[minimum];

/**
 * Compares two roles by authority: -1 when `a < b`, 0 when equal, 1 when
 * `a > b`. Mirrors `Array.prototype.sort` semantics.
 */
export const compareRoles = (a: Role, b: Role): -1 | 0 | 1 => {
  if (ROLE_RANK[a] < ROLE_RANK[b]) {
    return -1;
  }
  if (ROLE_RANK[a] > ROLE_RANK[b]) {
    return 1;
  }
  return 0;
};
