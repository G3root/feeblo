import type {
  TPlanComplianceResource,
  TPlanComplianceViolation,
  TPlanComplianceViolationKind,
  TWorkspacePlanCompliance,
} from "@feeblo/domain/plan-compliance/schema";
import { describe, expect, it } from "vitest";

import { isOverPlanPathAllowed } from "./over-plan-routes";

const organizationId = "org_test";

const resource = (
  id: string,
  kind: TPlanComplianceResource["kind"] = "board"
): TPlanComplianceResource => ({
  id,
  kind,
  label: id,
  detail: null,
});

const violation = (
  kind: TPlanComplianceViolationKind,
  resources: TPlanComplianceResource[] = []
): TPlanComplianceViolation => ({
  kind,
  count: resources.length,
  limit: null,
  resources,
});

const compliance = (
  overrides: Partial<TWorkspacePlanCompliance> = {}
): TWorkspacePlanCompliance => ({
  organizationId,
  plan: "free",
  violations: [],
  degraded: [],
  ...overrides,
});

describe("isOverPlanPathAllowed", () => {
  it("always allows the gate, billing, and personal settings", () => {
    const snapshot = compliance({
      violations: [violation("boards", [resource("board_1")])],
    });

    for (const path of [
      `/org_test/over-plan`,
      `/org_test/over-plan/`,
      `/org_test/settings/billing`,
      `/org_test/settings/profile`,
      `/org_test/settings/notifications`,
      `/org_test/settings/preferences`,
      `/org_test/settings/security`,
    ]) {
      expect(isOverPlanPathAllowed(path, organizationId, snapshot)).toBe(true);
    }
  });

  it("keeps the rest of the workspace behind the gate", () => {
    const snapshot = compliance({
      violations: [violation("boards", [resource("board_1")])],
    });

    for (const path of [
      `/org_test`,
      `/org_test/`,
      `/org_test/feedback`,
      `/org_test/settings/members`,
      `/org_test/settings/workspace`,
      `/org_test/settings/changelog-categories`,
      `/org_test/contact`,
      `/org_test/company`,
    ]) {
      expect(isOverPlanPathAllowed(path, organizationId, snapshot)).toBe(false);
    }
  });

  it("opens board and post pages only for a board finding", () => {
    const boards = compliance({
      violations: [violation("boards", [resource("board_1")])],
    });
    const privateBoards = compliance({
      violations: [violation("privateBoards", [resource("board_1", "board")])],
    });
    const categories = compliance({
      violations: [violation("changelogCategories", [])],
    });

    for (const snapshot of [boards, privateBoards]) {
      expect(
        isOverPlanPathAllowed(
          `/org_test/board/feedback`,
          organizationId,
          snapshot
        )
      ).toBe(true);
      expect(
        isOverPlanPathAllowed(
          `/org_test/post/feedback/a-post`,
          organizationId,
          snapshot
        )
      ).toBe(true);
    }

    expect(
      isOverPlanPathAllowed(
        `/org_test/board/feedback`,
        organizationId,
        categories
      )
    ).toBe(false);
  });

  it("opens the page that owns each fixable resource", () => {
    const crm = compliance({
      violations: [violation("crmEntries", [])],
    });
    const categories = compliance({
      violations: [violation("changelogCategories", [])],
    });

    expect(
      isOverPlanPathAllowed(`/org_test/contact`, organizationId, crm)
    ).toBe(true);
    expect(
      isOverPlanPathAllowed(`/org_test/company/acme`, organizationId, crm)
    ).toBe(true);
    expect(
      isOverPlanPathAllowed(
        `/org_test/settings/changelog-categories`,
        organizationId,
        categories
      )
    ).toBe(true);
  });

  it("opens the settings page that explains a degraded capability", () => {
    const degraded = compliance({
      degraded: [
        "integrations",
        "publicApi",
        "removeBranding",
        "widgetSso",
        "subscriberEmails",
      ],
    });

    for (const path of [
      `/org_test/settings/integrations`,
      `/org_test/settings/integrations/slack`,
      `/org_test/settings/developers`,
      `/org_test/settings/customize`,
      `/org_test/settings/widget`,
    ]) {
      expect(isOverPlanPathAllowed(path, organizationId, degraded)).toBe(true);
    }
  });

  it("does not open a degraded settings page the plan still includes", () => {
    const snapshot = compliance({ degraded: [] });

    expect(
      isOverPlanPathAllowed(
        `/org_test/settings/integrations`,
        organizationId,
        snapshot
      )
    ).toBe(false);
  });

  it("never allows a path that belongs to another workspace", () => {
    const snapshot = compliance({
      violations: [violation("boards", [resource("board_1")])],
    });

    expect(
      isOverPlanPathAllowed(
        `/org_other/board/feedback`,
        organizationId,
        snapshot
      )
    ).toBe(false);
    expect(
      isOverPlanPathAllowed(
        `/org_other/settings/billing`,
        organizationId,
        snapshot
      )
    ).toBe(false);
  });
});
