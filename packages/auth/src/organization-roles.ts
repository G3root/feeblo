import { createAccessControl } from "better-auth/plugins";

/**
 * better-auth organization-plugin access control, mirroring the roles in
 * `@feeblo/permissions`. Only gates org-plugin endpoints (invite, remove,
 * update role, team); everything else is gated by Feeblo's own policies.
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
});

/** Roles mirror the hierarchy in `@feeblo/permissions`: owner > admin > manager > contributor. */
export const ORGANIZATION_ROLES = {
  owner: organizationAccessControl.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["create", "read", "update", "delete"],
  }),
  admin: organizationAccessControl.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["create", "read", "update", "delete"],
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
