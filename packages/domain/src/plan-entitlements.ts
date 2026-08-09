export type OrganizationPlan = "free" | "starter" | "professional";

export type LimitFeatureKey =
  | "feedbackBoards"
  | "privilegedMembers"
  | "changelogCategories";
export type CapabilityFeatureKey =
  | "roadmap"
  | "changelog"
  | "unlimitedEndUsers"
  | "unlimitedPosts"
  | "privateBoards"
  | "privateRoadmaps"
  | "removeBranding"
  | "automaticSso";
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
  automaticSso: { kind: "capability", label: "Automatic SSO" },
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
] as const);

const CAPABILITY_FEATURE_ORDER = defineFeatureOrder<CapabilityFeatureKey>()([
  "roadmap",
  "changelog",
  "unlimitedEndUsers",
  "unlimitedPosts",
  "privateBoards",
  "privateRoadmaps",
  "removeBranding",
  "automaticSso",
] as const);

export const PLAN_ENTITLEMENTS = {
  free: {
    limits: {
      feedbackBoards: 2,
      privilegedMembers: 2,
      changelogCategories: 3,
    },
    capabilities: {
      roadmap: true,
      changelog: true,
      unlimitedEndUsers: true,
      unlimitedPosts: true,
      privateBoards: false,
      privateRoadmaps: false,
      removeBranding: false,
      automaticSso: false,
    },
  },
  starter: {
    limits: {
      feedbackBoards: 5,
      privilegedMembers: 5,
      changelogCategories: null,
    },
    capabilities: {
      roadmap: true,
      changelog: true,
      unlimitedEndUsers: true,
      unlimitedPosts: true,
      privateBoards: true,
      privateRoadmaps: true,
      removeBranding: true,
      automaticSso: true,
    },
  },
  professional: {
    limits: {
      feedbackBoards: null,
      privilegedMembers: null,
      changelogCategories: null,
    },
    capabilities: {
      roadmap: true,
      changelog: true,
      unlimitedEndUsers: true,
      unlimitedPosts: true,
      privateBoards: true,
      privateRoadmaps: true,
      removeBranding: true,
      automaticSso: true,
    },
  },
} as const satisfies Record<OrganizationPlan, PlanEntitlements>;

export const PAID_PLAN_KEYS = Object.keys(PLAN_ENTITLEMENTS).filter(
  (plan): plan is Exclude<OrganizationPlan, "free"> => plan !== "free"
);

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
