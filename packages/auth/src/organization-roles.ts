import { createAccessControl } from "better-auth/plugins";

/**
 * better-auth organization-plugin access control, mirroring the roles in
 * `@feeblo/permissions`. It gates org-plugin endpoints (invite, remove,
 * update role, team) and the api-key plugin's own endpoints: the plugin
 * authorizes every organization-owned key operation with
 * `hasPermission({ permissions: { apiKey: [action] } })` against this ACL, so
 * a role missing `apiKey` cannot mint or revoke a workspace credential even
 * though the endpoint is reachable by any session.
 *
 * Everything else is gated by Feeblo's own policies.
 *
 * Shared by the server (`server.ts`) and the client (`auth-client.ts`) so the
 * inferred invitation/member role types stay identical on both sides.
 */
export const organizationAccessControl = createAccessControl({
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
  apiKey: ["create", "read", "update", "delete"],
});

/** Roles mirror the hierarchy in `@feeblo/permissions`: owner > admin > manager > contributor. */
export const ORGANIZATION_ROLES = {
  owner: organizationAccessControl.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["create", "read", "update", "delete"],
    apiKey: ["create", "read", "update", "delete"],
  }),
  admin: organizationAccessControl.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["create", "read", "update", "delete"],
    apiKey: ["create", "read", "update", "delete"],
  }),
  manager: organizationAccessControl.newRole({
    organization: [],
    member: [],
    invitation: [],
    team: [],
    ac: ["read"],
  }),
  contributor: organizationAccessControl.newRole({
    organization: [],
    member: [],
    invitation: [],
    team: [],
    ac: ["read"],
  }),
} as const;

/**
 * The roles that may mint a workspace-wide machine credential.
 *
 * Derived from the ACL statement the api-key plugin itself checks on
 * `/api-key/create` (`apiKey: ["create"]`, granted to owner and admin), so a
 * consent that issues an OAuth grant cannot authorize more than the member
 * could authorize with a key. See `docs/adr/0024`.
 */
const WORKSPACE_CREDENTIAL_ROLES: ReadonlySet<string> = new Set(
  Object.entries(ORGANIZATION_ROLES)
    .filter(([, role]) => role.authorize({ apiKey: ["create"] }).success)
    .map(([name]) => name)
);

/**
 * Whether a stored `member.role` may authorize a client for the workspace.
 *
 * Comma-separated values are accepted because `member.role` is text and an
 * owner can hold more than one role. The check runs twice: when the consent's
 * workspace reference is resolved, and again on every access token, so a
 * demoted member's existing grant stops working.
 */
export const roleMayAuthorizeWorkspaceCredential = (role: string): boolean =>
  role.split(",").some((entry) => WORKSPACE_CREDENTIAL_ROLES.has(entry.trim()));
