import type {
  TPlanComplianceResource,
  TPlanComplianceViolation,
  TPlanComplianceViolationKind,
  TWorkspacePlanCompliance,
} from "@feeblo/domain/plan-compliance/schema";
import { describe, expect, it } from "vitest";

import { buildPlanComplianceView } from "./plan-compliance-view";
import type { PlanComplianceRow } from "./plan-compliance-view";

const resource = (
  id: string,
  kind: TPlanComplianceResource["kind"],
  detail: string | null = null,
  label = id
): TPlanComplianceResource => ({ id, kind, label, detail });

const violation = (
  kind: TPlanComplianceViolationKind,
  resources: TPlanComplianceResource[],
  overrides: Partial<TPlanComplianceViolation> = {}
): TPlanComplianceViolation => ({
  kind,
  count: resources.length,
  limit: null,
  resources,
  ...overrides,
});

const compliance = (
  violations: TPlanComplianceViolation[]
): TWorkspacePlanCompliance => ({
  organizationId: "org_test",
  plan: "free",
  violations,
  degraded: [],
});

describe("buildPlanComplianceView", () => {
  it("merges a private board into one row with both actions", () => {
    const view = buildPlanComplianceView(
      compliance([
        violation(
          "boards",
          [
            resource("board_1", "board", "412 posts", "Feedback"),
            resource("board_2", "board", "0 posts", "Public"),
            resource("board_3", "board", "7 posts", "Ideas"),
          ],
          { count: 3, limit: 2 }
        ),
        violation("privateBoards", [
          resource("board_1", "board", "412 posts", "Feedback"),
        ]),
      ]),
      { actorRole: "owner" }
    );

    expect(view.planLabel).toBe("Free");
    expect(view.sections).toHaveLength(1);

    const [boards] = view.sections;
    expect(boards?.title).toBe("Feedback boards");
    expect(boards?.summary).toContain("3 of 2 boards");
    expect(boards?.summary).toContain("1 of them private");
    expect(boards?.rows).toHaveLength(3);

    const privateRow = boards?.rows.find((row) => row.label === "Feedback");
    expect(privateRow?.badges).toEqual(["Private"]);
    expect(privateRow?.actions.map((action) => action.type)).toEqual([
      "make_board_public",
      "delete_board",
    ]);
    expect(privateRow?.actions[0]?.requiresTyping).toBe(true);
    expect(privateRow?.actions[1]?.destructive).toBe(true);

    const publicRow = boards?.rows.find((row) => row.label === "Public");
    expect(publicRow?.actions.map((action) => action.type)).toEqual([
      "delete_board",
    ]);
  });

  it("reports a private board on a plan without private boards", () => {
    const view = buildPlanComplianceView(
      compliance([
        violation("privateBoards", [
          resource("board_1", "board", "12 posts", "Secret"),
        ]),
      ]),
      { actorRole: "owner" }
    );

    expect(view.sections[0]?.summary).toBe(
      "1 private board. The Free plan does not include private boards."
    );
    expect(view.sections[0]?.rows[0]?.badges).toEqual(["Private"]);
  });

  const membersViolation = () =>
    violation(
      "members",
      [
        resource("member_owner", "member", "Owner", "Ada"),
        resource("member_admin", "member", "Admin", "Grace"),
        resource("member_manager", "member", "Manager", "Katherine"),
        resource(
          "invitation_admin",
          "invitation",
          "Pending invitation · Admin",
          "linus@example.com"
        ),
      ],
      { count: 4, limit: 2 }
    );

  const membersRow = (
    actorRole: string | null,
    label: string
  ): PlanComplianceRow | undefined => {
    const view = buildPlanComplianceView(compliance([membersViolation()]), {
      actorRole,
    });

    return view.sections[0]?.rows.find((row) => row.label === label);
  };

  it("offers removal to an owner for every member the server would accept", () => {
    const view = buildPlanComplianceView(compliance([membersViolation()]), {
      actorRole: "owner",
    });

    const [members] = view.sections;
    const ownerRow = members?.rows.find((row) => row.label === "Ada");
    const adminRow = members?.rows.find((row) => row.label === "Grace");
    const invitationRow = members?.rows.find(
      (row) => row.label === "linus@example.com"
    );

    expect(members?.title).toBe("Members");
    expect(members?.summary).toBe("4 members. The Free plan allows 2.");
    // An owner cannot be removed through team settings, so that row explains
    // itself instead of offering a button the server refuses.
    expect(ownerRow?.badges).toEqual(["Owner"]);
    expect(ownerRow?.actions).toEqual([]);
    expect(ownerRow?.detail).toBe(
      "Owners cannot be removed from the workspace."
    );
    expect(adminRow?.badges).toEqual(["Admin"]);
    expect(adminRow?.detail).toBeNull();
    expect(adminRow?.actions[0]?.type).toBe("remove_member");
    expect(adminRow?.actions[0]?.destructive).toBe(true);
    expect(invitationRow?.badges).toEqual([]);
    expect(invitationRow?.actions[0]?.type).toBe("cancel_invitation");
  });

  it("withholds removals an admin's rank does not allow", () => {
    // `canManageTarget` requires a strictly lower rank, so an admin cannot
    // remove another admin; only an owner can, and the row says so.
    expect(membersRow("admin", "Grace")?.actions).toEqual([]);
    expect(membersRow("admin", "Grace")?.detail).toBe(
      "Only an owner can remove an admin."
    );
    // The rank below the caller is unaffected.
    expect(membersRow("admin", "Katherine")?.actions[0]?.type).toBe(
      "remove_member"
    );
    // An invitation is not a member, so cancelling one is not rank-gated.
    expect(membersRow("admin", "linus@example.com")?.actions[0]?.type).toBe(
      "cancel_invitation"
    );
  });

  it("offers no removal when the caller's role is unknown", () => {
    expect(membersRow(null, "Katherine")?.actions).toEqual([]);
  });

  it("labels CRM rows by kind and keeps the destructive action typed", () => {
    const view = buildPlanComplianceView(
      compliance([
        violation(
          "crmEntries",
          [
            resource("contact_1", "contact", "ada@example.com", "Ada"),
            resource("company_1", "company", null, "Acme"),
          ],
          { count: 12, limit: 10 }
        ),
      ]),
      { actorRole: "owner" }
    );

    const [crmEntries] = view.sections;
    expect(crmEntries?.summary).toContain("12 CRM entries");
    expect(crmEntries?.truncated).toBe(true);
    expect(crmEntries?.rows[0]?.badges).toEqual(["Contact"]);
    expect(crmEntries?.rows[1]?.badges).toEqual(["Company"]);
    expect(crmEntries?.rows[0]?.actions[0]?.requiresTyping).toBe(true);
  });

  it("renders no sections when the snapshot withheld the resources", () => {
    const view = buildPlanComplianceView(
      compliance([
        violation("boards", [], { count: 7, limit: 2 }),
        violation("crmEntries", [], { count: 11, limit: 10 }),
      ]),
      { actorRole: "owner" }
    );

    expect(view.sections).toEqual([]);
  });

  it("renders nothing for a compliant workspace", () => {
    const view = buildPlanComplianceView(compliance([]), { actorRole: null });

    expect(view.sections).toEqual([]);
  });
});
