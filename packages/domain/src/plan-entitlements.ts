import { PAID_PLAN_KEYS as PAID_PLAN_KEYS_CONTRACT } from "@feeblo/domain-contracts/plan";

export type OrganizationPlan = "free" | "starter" | "professional";

/**
 * Providers whose connections and outbound deliveries require the
 * `integrations` capability. Webhook endpoints stay available on every plan
 * and are therefore excluded from delivery pauses.
 */
export const INTEGRATION_CAPABILITY_PROVIDER_KEYS = [
  "slack",
  "discord",
  "github",
] as const;

export type LimitFeatureKey =
  | "feedbackBoards"
  | "privilegedMembers"
  | "changelogCategories"
  | "submissionNotificationRecipients"
  | "crmEntries"
  | "workspaces";
export type CapabilityFeatureKey =
  | "roadmap"
  | "changelog"
  | "unlimitedEndUsers"
  | "unlimitedPosts"
  | "privateBoards"
  | "privateRoadmaps"
  | "removeBranding"
  | "subscriberEmails"
  | "widgetSso"
  | "integrations"
  | "publicApi";
export type PlanFeatureKey = LimitFeatureKey | CapabilityFeatureKey;

type PlanLimits = Record<LimitFeatureKey, number | null>;
type PlanCapabilities = Record<CapabilityFeatureKey, boolean>;

export type PlanEntitlements = {
  limits: PlanLimits;
  capabilities: PlanCapabilities;
};

type LimitFeatureDefinition = {
  kind: "limit";
  singularLabel: string;
  pluralLabel: string;
};

type CapabilityFeatureDefinition = {
  kind: "capability";
  label: string;
};

type PlanFeatureDefinition =
  | LimitFeatureDefinition
  | CapabilityFeatureDefinition;

export const PLAN_FEATURE_CATALOG = {
  feedbackBoards: {
    kind: "limit",
    singularLabel: "Feedback Board",
    pluralLabel: "Feedback Boards",
  },
  privilegedMembers: {
    kind: "limit",
    singularLabel: "Admin Role",
    pluralLabel: "Admin Roles",
  },
  changelogCategories: {
    kind: "limit",
    singularLabel: "Changelog Category",
    pluralLabel: "Changelog Categories",
  },
  submissionNotificationRecipients: {
    kind: "limit",
    singularLabel: "Submission Notification Recipient",
    pluralLabel: "Submission Notification Recipients",
  },
  crmEntries: {
    kind: "limit",
    singularLabel: "CRM Entry",
    pluralLabel: "CRM Entries",
  },
  workspaces: {
    kind: "limit",
    singularLabel: "Workspace",
    pluralLabel: "Workspaces",
  },
  roadmap: { kind: "capability", label: "Roadmap" },
  changelog: { kind: "capability", label: "Changelog" },
  unlimitedEndUsers: {
    kind: "capability",
    label: "Unlimited End Users",
  },
  unlimitedPosts: { kind: "capability", label: "Unlimited Posts" },
  privateBoards: { kind: "capability", label: "Private Boards" },
  privateRoadmaps: { kind: "capability", label: "Private Roadmaps" },
  removeBranding: {
    kind: "capability",
    label: "Remove Feeblo Branding",
  },
  subscriberEmails: {
    kind: "capability",
    label: "Subscriber Email Notifications",
  },
  widgetSso: { kind: "capability", label: "Widget SSO" },
  integrations: {
    kind: "capability",
    label: "Integrations",
  },
  publicApi: {
    kind: "capability",
    label: "Public API",
  },
} as const satisfies Record<PlanFeatureKey, PlanFeatureDefinition>;

const defineFeatureOrder =
  <FeatureKey extends PlanFeatureKey>() =>
  <const Order extends readonly FeatureKey[]>(
    order: Order & ([FeatureKey] extends [Order[number]] ? unknown : never)
  ): Order =>
    order;

const LIMIT_FEATURE_ORDER = defineFeatureOrder<LimitFeatureKey>()([
  "feedbackBoards",
  "privilegedMembers",
  "changelogCategories",
  "submissionNotificationRecipients",
  "crmEntries",
  "workspaces",
] as const);

const CAPABILITY_FEATURE_ORDER = defineFeatureOrder<CapabilityFeatureKey>()([
  "roadmap",
  "changelog",
  "integrations",
  "publicApi",
  "subscriberEmails",
  "unlimitedEndUsers",
  "unlimitedPosts",
  "privateBoards",
  "privateRoadmaps",
  "removeBranding",
  "widgetSso",
] as const);

export const PLAN_ENTITLEMENTS = {
  free: {
    limits: {
      feedbackBoards: 2,
      privilegedMembers: 2,
      changelogCategories: 3,
      submissionNotificationRecipients: 1,
      crmEntries: 10,
      workspaces: 3,
    },
    capabilities: {
      roadmap: true,
      changelog: true,
      unlimitedEndUsers: true,
      unlimitedPosts: true,
      privateBoards: false,
      privateRoadmaps: false,
      removeBranding: false,
      subscriberEmails: false,
      widgetSso: false,
      integrations: false,
      publicApi: false,
    },
  },
  starter: {
    limits: {
      feedbackBoards: 5,
      privilegedMembers: 5,
      changelogCategories: null,
      submissionNotificationRecipients: null,
      crmEntries: null,
      workspaces: null,
    },
    capabilities: {
      roadmap: true,
      changelog: true,
      unlimitedEndUsers: true,
      unlimitedPosts: true,
      privateBoards: true,
      privateRoadmaps: true,
      removeBranding: true,
      subscriberEmails: true,
      widgetSso: true,
      integrations: true,
      publicApi: true,
    },
  },
  professional: {
    limits: {
      feedbackBoards: null,
      privilegedMembers: null,
      changelogCategories: null,
      submissionNotificationRecipients: null,
      crmEntries: null,
      workspaces: null,
    },
    capabilities: {
      roadmap: true,
      changelog: true,
      unlimitedEndUsers: true,
      unlimitedPosts: true,
      privateBoards: true,
      privateRoadmaps: true,
      removeBranding: true,
      subscriberEmails: true,
      widgetSso: true,
      integrations: true,
      publicApi: true,
    },
  },
} as const satisfies Record<OrganizationPlan, PlanEntitlements>;

export const PLAN_KEYS = Object.keys(PLAN_ENTITLEMENTS).filter(
  (plan): plan is OrganizationPlan => plan in PLAN_ENTITLEMENTS
);

export const PLAN_DISPLAY_NAMES = {
  free: "Free",
  starter: "Starter",
  professional: "Professional",
} as const satisfies Record<OrganizationPlan, string>;

/**
 * Plan keys that grant paid entitlements. The literal is owned by
 * `@feeblo/domain-contracts/plan` — `@feeblo/db/schema/billing` gates SQL on
 * the same list and cannot import this package — and must equal every
 * non-free key of `PLAN_ENTITLEMENTS`; `plan-entitlements.test.ts` enforces
 * that equality.
 */
export const PAID_PLAN_KEYS = PAID_PLAN_KEYS_CONTRACT;

export type PlanFeatureRow = {
  key: PlanFeatureKey;
  label: string;
};

export const getPlanFeatureRows = (
  plan: OrganizationPlan
): readonly PlanFeatureRow[] => {
  const entitlements: PlanEntitlements = PLAN_ENTITLEMENTS[plan];
  const rows: PlanFeatureRow[] = [];

  for (const key of LIMIT_FEATURE_ORDER) {
    const definition = PLAN_FEATURE_CATALOG[key];
    const limit = entitlements.limits[key];
    rows.push({
      key,
      label:
        limit === null
          ? `Unlimited ${definition.pluralLabel}`
          : `${limit} ${
              limit === 1 ? definition.singularLabel : definition.pluralLabel
            }`,
    });
  }

  for (const key of CAPABILITY_FEATURE_ORDER) {
    if (entitlements.capabilities[key]) {
      rows.push({ key, label: PLAN_FEATURE_CATALOG[key].label });
    }
  }

  return rows;
};
