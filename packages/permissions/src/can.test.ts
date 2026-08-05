import { describe, expect, it } from "vitest";

import {
  can,
  canAll,
  canAny,
  compareRoles,
  createPermissions,
  isInvitableRole,
  isMember,
  isOwnerOrAdmin,
  isPrivilegedRole,
  isRole,
  type PermissionContext,
  permissionsForRole,
  PERMISSIONS,
  type Role,
  roleAtLeast,
  roleGrants,
  roleIn,
  ROLES,
} from "./index";

const ctx = (
  roles: ReadonlyArray<readonly [organizationId: string, role: Role]>
): PermissionContext => ({
  memberships: roles.map(([organizationId, role]) => ({
    organizationId,
    role,
  })),
});

const org = "org_1";

describe("roles", () => {
  it("ranks contributor < manager < admin < owner", () => {
    expect(compareRoles("contributor", "manager")).toBe(-1);
    expect(compareRoles("manager", "admin")).toBe(-1);
    expect(compareRoles("admin", "owner")).toBe(-1);
    expect(compareRoles("admin", "admin")).toBe(0);
    expect(compareRoles("owner", "admin")).toBe(1);
    expect(roleAtLeast("admin", "manager")).toBe(true);
    expect(roleAtLeast("manager", "admin")).toBe(false);
    expect(roleAtLeast("contributor", "contributor")).toBe(true);
  });

  it("recognizes privileged roles only", () => {
    expect(isPrivilegedRole("owner")).toBe(true);
    expect(isPrivilegedRole("admin")).toBe(true);
    expect(isPrivilegedRole("manager")).toBe(false);
    expect(isPrivilegedRole("contributor")).toBe(false);
    expect(isPrivilegedRole("moderator")).toBe(false);

    // Privilege is derived from the workspace.update grant, not a hardcoded
    // role list — this invariant pins that equivalence for every role.
    for (const role of ROLES) {
      expect(isPrivilegedRole(role)).toBe(
        roleGrants(role, "workspace.update")
      );
    }
  });

  it("only allows inviting admin/manager/contributor", () => {
    expect(isInvitableRole("admin")).toBe(true);
    expect(isInvitableRole("manager")).toBe(true);
    expect(isInvitableRole("contributor")).toBe(true);
    expect(isInvitableRole("owner")).toBe(false);
  });

  it("guards the role literal", () => {
    expect(isRole("manager")).toBe(true);
    expect(isRole("member")).toBe(false);
    expect(isRole("moderator")).toBe(false);
    expect(isRole(42)).toBe(false);
  });
});

describe("role permissions", () => {
  it("creates action permissions and one resource wildcard", () => {
    expect(createPermissions("posts", ["create", "delete"] as const)).toEqual([
      "posts.create",
      "posts.delete",
      "posts.*",
    ]);

    const resources = new Set(PERMISSIONS.map((permission) => permission.split(".")[0]));
    for (const resource of resources) {
      expect(PERMISSIONS).toContain(`${resource}.*`);
    }
    expect(PERMISSIONS.every((permission) => permission.split(".").length === 2)).toBe(
      true
    );
  });

  it("only grants contributors the cross-post move permission", () => {
    expect([...permissionsForRole("contributor")]).toEqual(["posts.move"]);
    expect(roleGrants("contributor", "posts.move")).toBe(true);
    expect(roleGrants("contributor", "posts.status")).toBe(false);
  });

  it("grants resource wildcards to managers and above", () => {
    for (const role of ["manager", "admin", "owner"] as const) {
      expect(roleGrants(role, "posts.*")).toBe(true);
      expect(roleGrants(role, "posts.lock")).toBe(true);
      expect(roleGrants(role, "changelog.*")).toBe(true);
      expect(roleGrants(role, "tags.*")).toBe(true);
      expect(roleGrants(role, "roadmap.*")).toBe(true);
      expect(roleGrants(role, "comments.*")).toBe(true);
      expect(roleGrants(role, "members.remove")).toBe(true);
      expect(roleGrants(role, "changelog.create")).toBe(true);
      expect(roleGrants(role, "tags.create")).toBe(true);
      expect(roleGrants(role, "contacts.create")).toBe(true);
      expect(roleGrants(role, "companies.update")).toBe(true);
    }
    expect(roleGrants("owner", "boards.*")).toBe(true);
    expect(roleGrants("admin", "boards.*")).toBe(true);
    for (const action of ["create", "update", "delete"] as const) {
      expect(roleGrants("owner", `boards.${action}`)).toBe(true);
      expect(roleGrants("admin", `boards.${action}`)).toBe(true);
      expect(roleGrants("manager", `boards.${action}`)).toBe(false);
      expect(roleGrants("contributor", `boards.${action}`)).toBe(false);
    }
    expect(roleGrants("contributor", "changelog.create")).toBe(false);
    expect(roleGrants("contributor", "tags.create")).toBe(false);
    expect(roleGrants("contributor", "contacts.create")).toBe(false);
  });

  it("grants workspace updates only to privileged roles", () => {
    expect(roleGrants("owner", "workspace.update")).toBe(true);
    expect(roleGrants("admin", "workspace.update")).toBe(true);
    expect(roleGrants("manager", "workspace.update")).toBe(false);
    expect(roleGrants("contributor", "workspace.update")).toBe(false);
  });

  it("grants organization deletion to admin and owner", () => {
    expect(roleGrants("owner", "workspace.delete")).toBe(true);
    expect(roleGrants("admin", "workspace.delete")).toBe(true);
  });

  it("gives admin and owner identical effective permissions", () => {
    const admin = permissionsForRole("admin");
    expect(admin.has("posts.*")).toBe(true);
    expect(admin.has("comments.*")).toBe(true);
    expect(roleGrants("admin", "comments.delete")).toBe(true);
    expect(admin.has("billing.*")).toBe(true);

    const owner = permissionsForRole("owner");
    expect([...owner]).toEqual([...admin]);
    expect(owner.has("workspace.delete")).toBe(true);
  });
});

describe("can()", () => {
  it("denies when the context is missing or the user is not a member", () => {
    expect(can(null, org, "posts.*")).toBe(false);
    expect(can(undefined, org, "posts.*")).toBe(false);
    expect(can(ctx([]), org, "posts.*")).toBe(false);
    expect(can(ctx([["org_other", "admin"]]), org, "posts.*")).toBe(false);
  });

  it("checks the org-scoped membership only", () => {
    // Admin in org B must NOT unlock privileged permissions in org A.
    const session = ctx([
      ["org_a", "manager"],
      ["org_b", "admin"],
    ]);
    expect(can(session, "org_a", "posts.lock")).toBe(true);
    expect(can(session, "org_a", "boards.create")).toBe(false);
    expect(can(session, "org_b", "posts.lock")).toBe(true);
    expect(can(session, "org_b", "boards.create")).toBe(true);
  });

  it("denies can() for a contributor on content-management and privileged permissions", () => {
    const session = ctx([[org, "contributor"]]);
    for (const permission of [
      "workspace.update",
      "boards.create",
      "boards.*",
      "changelog.create",
      "tags.create",
      "posts.*",
      "comments.*",
      "members.invite",
      "members.remove",
      "members.assign",
      "billing.*",
      "site.*",
      "roadmap.*",
      "contacts.create",
      "contacts.*",
      "companies.create",
      "companies.*",
    ] as const) {
      expect(can(session, org, permission), permission).toBe(false);
    }
  });

  it("recognizes contributors as members with their limited move permission", () => {
    const session = ctx([[org, "contributor"]]);
    expect(isMember(session, org)).toBe(true);
    expect([...permissionsForRole("contributor")]).toEqual(["posts.move"]);
  });

  it("allows managers to run content operations contributors cannot", () => {
    const session = ctx([[org, "manager"]]);
    for (const permission of [
      "members.remove",
      "posts.*",
      "changelog.create",
      "changelog.*",
      "tags.create",
      "tags.*",
      "roadmap.*",
      "comments.*",
      "contacts.create",
      "contacts.update",
      "companies.create",
      "companies.update",
    ] as const) {
      expect(can(session, org, permission), permission).toBe(true);
    }
    expect(can(session, org, "boards.create")).toBe(false);
    expect(can(session, org, "boards.*")).toBe(false);
  });

  it("canAny/canAll compose correctly", () => {
    const session = ctx([[org, "admin"]]);
    expect(canAny(session, org, ["posts.*", "workspace.delete"])).toBe(
      true
    );
    expect(canAll(session, org, ["posts.*", "billing.*"])).toBe(
      true
    );
    expect(canAll(session, org, ["posts.*", "workspace.delete"])).toBe(
      true
    );
  });

  it("roleIn/isMember/isOwnerOrAdmin helpers agree", () => {
    const session = ctx([
      [org, "admin"],
      ["org_other", "manager"],
    ]);
    expect(roleIn(session, org)).toBe("admin");
    expect(isMember(session, org)).toBe(true);
    expect(isOwnerOrAdmin(session, org)).toBe(true);
    expect(isOwnerOrAdmin(session, "org_other")).toBe(false);
    expect(isMember(ctx([]), org)).toBe(false);
  });
});
