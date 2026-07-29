import { describe, expect, it } from "vitest";
import { getPlanFeatureRows, PLAN_ENTITLEMENTS } from "./plan-entitlements";

describe("plan feature catalog", () => {
  it("projects starter enforcement values into customer-facing feature rows", () => {
    expect(PLAN_ENTITLEMENTS.starter).toEqual({
      limits: {
        feedbackBoards: 5,
        privilegedMembers: 5,
      },
      capabilities: {
        changelog: true,
        privateBoards: true,
        removeBranding: true,
        roadmap: true,
        unlimitedEndUsers: true,
        unlimitedPosts: true,
      },
    });

    expect(getPlanFeatureRows("starter")).toEqual([
      { key: "feedbackBoards", label: "5 Feedback Boards" },
      { key: "privilegedMembers", label: "5 Admin Roles" },
      { key: "roadmap", label: "Roadmap" },
      { key: "changelog", label: "Changelog" },
      { key: "unlimitedEndUsers", label: "Unlimited End Users" },
      { key: "unlimitedPosts", label: "Unlimited Posts" },
      { key: "privateBoards", label: "Private Boards" },
      { key: "removeBranding", label: "Remove Feeblo Branding" },
    ]);
  });

  it("formats unlimited professional limits from the same entitlement values", () => {
    expect(getPlanFeatureRows("professional").slice(0, 2)).toEqual([
      { key: "feedbackBoards", label: "Unlimited Feedback Boards" },
      { key: "privilegedMembers", label: "Unlimited Admin Roles" },
    ]);
  });
});
