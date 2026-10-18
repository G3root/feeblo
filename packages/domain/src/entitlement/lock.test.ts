import { describe, expect, it } from "vitest";

import {
  computeKeptIds,
  computePlanLockState,
  countLockedResources,
  orderLockResources,
  planLocksResources,
  type PlanLockFeatureInput,
  type PlanLockResource,
} from "./lock";

const resource = (id: string, createdAt: string): PlanLockResource => ({
  id,
  createdAt: new Date(createdAt),
});

const resources = [
  resource("brd_oldest", "2026-01-01T00:00:00Z"),
  resource("brd_middle", "2026-01-02T00:00:00Z"),
  resource("brd_newest", "2026-01-03T00:00:00Z"),
];

const feature = (
  overrides: Partial<PlanLockFeatureInput> = {}
): PlanLockFeatureInput => ({
  limit: 2,
  resources,
  selectedIds: [],
  ...overrides,
});

const features = (input: PlanLockFeatureInput) => ({
  feedbackBoards: input,
  privilegedMembers: { limit: null, resources: [], selectedIds: [] },
  changelogCategories: { limit: null, resources: [], selectedIds: [] },
  crmEntries: { limit: null, resources: [], selectedIds: [] },
  workspaces: { limit: null, resources: [], selectedIds: [] },
});

describe("plan lock math", () => {
  it("keeps everything when the limit is null", () => {
    expect(computeKeptIds({ resources, limit: null, selectedIds: [] })).toEqual(
      ["brd_oldest", "brd_middle", "brd_newest"]
    );
  });

  it("keeps everything while the count is within the limit", () => {
    expect(computeKeptIds({ resources, limit: 3, selectedIds: [] })).toEqual([
      "brd_oldest",
      "brd_middle",
      "brd_newest",
    ]);
  });

  it("keeps the oldest resources when over the limit and nothing is selected", () => {
    expect(computeKeptIds({ resources, limit: 2, selectedIds: [] })).toEqual([
      "brd_oldest",
      "brd_middle",
    ]);
  });

  it("caps a selection at the limit in stable resource order", () => {
    expect(
      computeKeptIds({
        resources,
        limit: 2,
        selectedIds: ["brd_newest", "brd_middle", "brd_oldest"],
      })
    ).toEqual(["brd_oldest", "brd_middle"]);
  });

  it("fills the remaining slots oldest-first around a selection", () => {
    expect(
      computeKeptIds({
        resources,
        limit: 2,
        selectedIds: ["brd_newest"],
      })
    ).toEqual(["brd_newest", "brd_oldest"]);
  });

  it("ignores a selected id that no longer exists", () => {
    expect(
      computeKeptIds({
        resources,
        limit: 2,
        selectedIds: ["brd_deleted"],
      })
    ).toEqual(["brd_oldest", "brd_middle"]);
  });

  it("breaks a createdAt tie by id so the keeper set is stable", () => {
    const tied = [
      resource("brd_b", "2026-01-01T00:00:00Z"),
      resource("brd_a", "2026-01-01T00:00:00Z"),
    ];

    expect(orderLockResources(tied).map(({ id }) => id)).toEqual([
      "brd_a",
      "brd_b",
    ]);
    expect(
      computeKeptIds({ resources: tied, limit: 1, selectedIds: [] })
    ).toEqual(["brd_a"]);
  });

  it("locks resources only on the free plan", () => {
    expect(planLocksResources("free")).toBe(true);
    expect(planLocksResources("starter")).toBe(false);
    expect(planLocksResources("professional")).toBe(false);
  });

  it("reports kept and locked resources on free", () => {
    const state = computePlanLockState({
      plan: "free",
      features: features(feature()),
    });
    const boards = state.features.find(
      (entry) => entry.feature === "feedbackBoards"
    );

    expect(boards).toEqual({
      feature: "feedbackBoards",
      limit: 2,
      count: 3,
      keptIds: ["brd_oldest", "brd_middle"],
      lockedIds: ["brd_newest"],
    });
    expect(countLockedResources(state)).toBe(1);
  });

  it("keeps every resource and locks none on a paid plan", () => {
    const state = computePlanLockState({
      plan: "starter",
      features: features(feature()),
    });
    const boards = state.features.find(
      (entry) => entry.feature === "feedbackBoards"
    );

    expect(boards?.lockedIds).toEqual([]);
    expect(boards?.keptIds).toEqual(["brd_oldest", "brd_middle", "brd_newest"]);
    expect(countLockedResources(state)).toBe(0);
  });
});
