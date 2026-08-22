import { describe, expect, it } from "vitest";

import { getPlanFeatureRows, PLAN_ENTITLEMENTS } from "./plan-entitlements";

describe("plan feature catalog", () => {
  it("excludes disabled free capabilities while retaining enabled features", () => {
    const rows = getPlanFeatureRows("free");

    expect(rows).toContainEqual({ key: "roadmap", label: "Roadmap" });
    expect(rows).toContainEqual({
      key: "unlimitedPosts",
      label: "Unlimited Posts",
    });
    expect(rows).not.toContainEqual({
      key: "privateBoards",
      label: "Private Boards",
    });
    expect(rows).not.toContainEqual({
      key: "privateRoadmaps",
      label: "Private Roadmaps",
    });
    expect(rows).not.toContainEqual({
      key: "removeBranding",
      label: "Remove Feeblo Branding",
    });
    expect(rows).not.toContainEqual({
      key: "widgetSso",
      label: "Widget SSO",
    });
    expect(rows).not.toContainEqual({
      key: "integrations",
      label: "Integrations",
    });
  });

  it("projects starter enforcement values into customer-facing feature rows", () => {
    expect(PLAN_ENTITLEMENTS.starter).toEqual({
      limits: {
        feedbackBoards: 5,
        privilegedMembers: 5,
        changelogCategories: null,
        submissionNotificationRecipients: null,
        crmEntries: null,
      },
      capabilities: {
        changelog: true,
        widgetSso: true,
        privateBoards: true,
        privateRoadmaps: true,
        removeBranding: true,
        roadmap: true,
        subscriberEmails: true,
        unlimitedEndUsers: true,
        unlimitedPosts: true,
        integrations: true,
      },
    });

    expect(getPlanFeatureRows("starter")).toEqual([
      { key: "feedbackBoards", label: "5 Feedback Boards" },
      { key: "privilegedMembers", label: "5 Admin Roles" },
      { key: "changelogCategories", label: "Unlimited Changelog Categories" },
      {
        key: "submissionNotificationRecipients",
        label: "Unlimited Submission Notification Recipients",
      },
      { key: "crmEntries", label: "Unlimited CRM Entries" },
      { key: "roadmap", label: "Roadmap" },
      { key: "changelog", label: "Changelog" },
      { key: "integrations", label: "Integrations" },
      {
        key: "subscriberEmails",
        label: "Subscriber Email Notifications",
      },
      { key: "unlimitedEndUsers", label: "Unlimited End Users" },
      { key: "unlimitedPosts", label: "Unlimited Posts" },
      { key: "privateBoards", label: "Private Boards" },
      { key: "privateRoadmaps", label: "Private Roadmaps" },
      { key: "removeBranding", label: "Remove Feeblo Branding" },
      { key: "widgetSso", label: "Widget SSO" },
    ]);
  });

  it("formats unlimited professional limits from the same entitlement values", () => {
    expect(getPlanFeatureRows("professional").slice(0, 2)).toEqual([
      { key: "feedbackBoards", label: "Unlimited Feedback Boards" },
      { key: "privilegedMembers", label: "Unlimited Admin Roles" },
    ]);
  });
});
