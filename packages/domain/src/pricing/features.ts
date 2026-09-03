import type { OrganizationPlan, PlanFeatureKey } from "../plan-entitlements";

export type PricingFeatureRow = {
  key: PlanFeatureKey;
  label: string;
};

/**
 * Hand-authored feature rows per plan, rendered verbatim on pricing surfaces.
 *
 * Higher plans intentionally list only what is new or improved over lower
 * plans — the UI prefixes them with the "Everything in X, plus:" label
 * derived from the plan order. Edit copy freely; keys must be known feature
 * keys, but nothing here is derived from PLAN_ENTITLEMENTS.
 */
export const PLAN_PRICING_FEATURES = {
  free: [
    { key: "feedbackBoards", label: "2 Feedback Boards" },
    { key: "privilegedMembers", label: "2 Admin Roles" },
    { key: "changelogCategories", label: "3 Changelog Categories" },
    {
      key: "submissionNotificationRecipients",
      label: "1 Submission Notification Recipient",
    },
    { key: "crmEntries", label: "10 CRM Entries" },
    { key: "roadmap", label: "Roadmap" },
    { key: "changelog", label: "Changelog" },
    { key: "unlimitedEndUsers", label: "Unlimited End Users" },
    { key: "unlimitedPosts", label: "Unlimited Posts" },
  ],
  starter: [
    { key: "feedbackBoards", label: "5 Feedback Boards" },
    { key: "privilegedMembers", label: "5 Admin Roles" },
    { key: "changelogCategories", label: "Unlimited Changelog Categories" },
    {
      key: "submissionNotificationRecipients",
      label: "Unlimited Submission Notification Recipients",
    },
    { key: "crmEntries", label: "Unlimited CRM Entries" },
    { key: "integrations", label: "Integrations" },
    {
      key: "subscriberEmails",
      label: "Subscriber Email Notifications",
    },
    { key: "privateBoards", label: "Private Boards" },
    { key: "privateRoadmaps", label: "Private Roadmaps" },
    { key: "removeBranding", label: "Remove Feeblo Branding" },
    { key: "widgetSso", label: "Widget SSO" },
  ],
  professional: [
    { key: "feedbackBoards", label: "Unlimited Feedback Boards" },
    { key: "privilegedMembers", label: "Unlimited Admin Roles" },
  ],
} as const satisfies Record<OrganizationPlan, readonly PricingFeatureRow[]>;
