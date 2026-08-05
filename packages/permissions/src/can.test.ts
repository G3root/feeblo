import { describe, expect, it } from "vitest";

import {
  can,
  canAll,
  canAny,
  compareRoles,
  isInvitablerole,
  isMember,
  isOwnerOrAdmin,
  isPrivilegedRole,
  isRole,
  type PermissionContext,
  permissionsForRole,
  type Role,
  roleAtLeast,
  roleGrants,
  roleIn,
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
  });

  it("only allows inviting admin/manager/contributor", () => {
    expect(isInvitablerole("admin")).toBe(true);
    expect(isInvitablerole("manager")).toBe(true);
    expect(isInvitablerole("contributor")).toBe(true);
    expect(isInvitablerole("owner")).toBe(false);
  });

  it("guards the role literal", () => {
    expect(isRole("manager")).toBe(true);
    expect(isRole("member")).toBe(false);
    expect(isRole("moderator")).toBe(false);
    expect(isRole(42)).toBe(false);
  });
});

describe("role permissions", () => {
  it("grants contribution permissions to every role (inheritance)", () => {
    for (const role of ["contributor", "manager", "admin", "owner"] as const) {
      expect(roleGrants(role, "posts.create")).toBe(true);
      expect(roleGrants(role, "posts.vote")).toBe(true);
      expect(roleGrants(role, "posts.comment")).toBe(true);
      expect(roleGrants(role, "notifications.manage")).toBe(true);
    }
  });

  it("grants content-management permissions to manager and above", () => {
    for (const role of ["manager", "admin", "owner"] as const) {
      expect(roleGrants(role, "boards.create")).toBe(true);
      expect(roleGrants(role, "changelog.create")).toBe(true);
      expect(roleGrants(role, "tags.create")).toBe(true);
      expect(roleGrants(role, "contacts.create")).toBe(true);
      expect(roleGrants(role, "companies.update")).toBe(true);
    }
    expect(roleGrants("contributor", "boards.create")).toBe(false);
    expect(roleGrants("contributor", "changelog.create")).toBe(false);
    expect(roleGrants("contributor", "tags.create")).toBe(false);
    expect(roleGrants("contributor", "contacts.create")).toBe(false);
  });

  it("grants workspace.manage only to privileged roles", () => {
    expect(roleGrants("owner", "workspace.manage")).toBe(true);
    expect(roleGrants("admin", "workspace.manage")).toBe(true);
    expect(roleGrants("manager", "workspace.manage")).toBe(false);
    expect(roleGrants("contributor", "workspace.manage")).toBe(false);
  });

  it("grants posts.moderate only to privileged roles (no author exception)", () => {
    expect(roleGrants("owner", "posts.moderate")).toBe(true);
    expect(roleGrants("admin", "posts.moderate")).toBe(true);
    expect(roleGrants("manager", "posts.moderate")).toBe(false);
    expect(roleGrants("contributor", "posts.moderate")).toBe(false);
  });

  it("grants owner-only permissions only to owner", () => {
    expect(roleGrants("owner", "workspace.delete")).toBe(true);
    expect(roleGrants("admin", "workspace.delete")).toBe(false);
    expect(roleGrants("owner", "members.roles.owner")).toBe(true);
    expect(roleGrants("admin", "members.roles.owner")).toBe(false);
  });

  it("computes the full effective set per role", () => {
    const admin = permissionsForRole("admin");
    expect(admin.has("posts.create")).toBe(true);
    expect(admin.has("boards.create")).toBe(true);
    expect(admin.has("posts.moderate")).toBe(true);
    expect(admin.has("billing.manage")).toBe(true);

    const owner = permissionsForRole("owner");
    for (const permission of admin) {
      expect(owner.has(permission)).toBe(true);
    }
    expect(owner.has("workspace.delete")).toBe(true);

    const manager = permissionsForRole("manager");
    expect(manager.has("posts.create")).toBe(true);
    expect(manager.has("boards.create")).toBe(true);
    expect(manager.has("posts.moderate")).toBe(false);
  });
});

describe("can()", () => {
  it("denies when the context is missing or the user is not a member", () => {
    expect(can(null, org, "posts.create")).toBe(false);
    expect(can(undefined, org, "posts.create")).toBe(false);
    expect(can(ctx([]), org, "posts.create")).toBe(false);
    expect(can(ctx([["org_other", "admin"]]), org, "posts.create")).toBe(false);
  });

  it("checks the org-scoped membership only", () => {
    // Admin in org B must NOT unlock privileged permissions in org A.
    const session = ctx([
      ["org_a", "manager"],
      ["org_b", "admin"],
    ]);
    expect(can(session, "org_a", "posts.moderate")).toBe(false);
    expect(can(session, "org_a", "posts.create")).toBe(true);
    expect(can(session, "org_a", "boards.create")).toBe(true);
    expect(can(session, "org_b", "posts.moderate")).toBe(true);
  });

  it("denies can() for a contributor on content-management and privileged permissions", () => {
    const session = ctx([[org, "contributor"]]);
    for (const permission of [
      "workspace.manage",
      "boards.create",
      "boards.manage",
      "changelog.create",
      "tags.create",
      "posts.manage",
      "posts.moderate",
      "members.invite",
      "members.remove",
      "members.roles.assign",
      "billing.manage",
      "site.manage",
      "roadmap.manage",
      "contacts.create",
      "contacts.manage",
      "companies.create",
      "companies.manage",
    ] as const) {
      expect(can(session, org, permission), permission).toBe(false);
    }
  });

  it("allows contributors to create/vote/comment on posts", () => {
    const session = ctx([[org, "contributor"]]);
    for (const permission of [
      "posts.create",
      "posts.vote",
      "posts.comment",
      "members.view",
      "notifications.manage",
    ] as const) {
      expect(can(session, org, permission), permission).toBe(true);
    }
  });

  it("allows managers to run content operations contributors cannot", () => {
    const session = ctx([[org, "manager"]]);
    for (const permission of [
      "boards.create",
      "changelog.create",
      "tags.create",
      "contacts.create",
      "contacts.update",
      "companies.create",
      "companies.update",
    ] as const) {
      expect(can(session, org, permission), permission).toBe(true);
    }
    expect(can(session, org, "posts.moderate")).toBe(false);
    expect(can(session, org, "members.remove")).toBe(false);
  });

  it("canAny/canAll compose correctly", () => {
    const session = ctx([[org, "admin"]]);
    expect(canAny(session, org, ["posts.moderate", "workspace.delete"])).toBe(
      true
    );
    expect(canAll(session, org, ["posts.moderate", "billing.manage"])).toBe(
      true
    );
    expect(canAll(session, org, ["posts.moderate", "workspace.delete"])).toBe(
      false
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
