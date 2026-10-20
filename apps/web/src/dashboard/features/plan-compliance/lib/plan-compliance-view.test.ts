import type {
  TPlanComplianceResource,
  TPlanComplianceViolation,
  TPlanComplianceViolationKind,
  TWorkspacePlanCompliance,
} from "@feeblo/domain/plan-compliance/schema";
import { describe, expect, it } from "vitest";

import { buildPlanComplianceView } from "./plan-compliance-view";

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
      ])
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
      ])
    );

    expect(view.sections[0]?.summary).toBe(
      "1 private board. The Free plan does not include private boards."
    );
    expect(view.sections[0]?.rows[0]?.badges).toEqual(["Private"]);
  });

  it("offers no row action for an owner and only an owner may demote an admin", () => {
    const view = buildPlanComplianceView(
      compliance([
        violation(
          "adminRoles",
          [
            resource("member_owner", "member", "Owner", "Ada"),
            resource("member_admin", "member", "Admin", "Grace"),
            resource(
              "invitation_admin",
              "invitation",
              "Pending invitation · Admin",
              "linus@example.com"
            ),
          ],
          { count: 3, limit: 2 }
        ),
      ])
    );

    const [adminRoles] = view.sections;
    const ownerRow = adminRoles?.rows.find((row) => row.label === "Ada");
    const adminRow = adminRoles?.rows.find((row) => row.label === "Grace");
    const invitationRow = adminRoles?.rows.find(
      (row) => row.label === "linus@example.com"
    );

    expect(ownerRow?.actions).toEqual([]);
    expect(adminRow?.actions[0]?.type).toBe("demote_admin");
    expect(adminRow?.actions[0]?.ownerOnly).toBe(true);
    expect(invitationRow?.actions[0]?.type).toBe("cancel_invitation");
    expect(invitationRow?.actions[0]?.ownerOnly).toBe(false);
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
      ])
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
      ])
    );

    expect(view.sections).toEqual([]);
  });

  it("renders nothing for a compliant workspace", () => {
    expect(buildPlanComplianceView(compliance([])).sections).toEqual([]);
  });
});
