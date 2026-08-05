export type OrganizationPlan = "free" | "starter" | "professional";

export type LimitFeatureKey = "feedbackBoards" | "privilegedMembers";
export type CapabilityFeatureKey =
  | "roadmap"
  | "changelog"
  | "unlimitedEndUsers"
  | "unlimitedPosts"
  | "privateBoards"
  | "removeBranding";
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
  roadmap: { kind: "capability", label: "Roadmap" },
  changelog: { kind: "capability", label: "Changelog" },
  unlimitedEndUsers: {
    kind: "capability",
    label: "Unlimited End Users",
  },
  unlimitedPosts: { kind: "capability", label: "Unlimited Posts" },
  privateBoards: { kind: "capability", label: "Private Boards" },
  removeBranding: {
    kind: "capability",
    label: "Remove Feeblo Branding",
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
] as const);

const CAPABILITY_FEATURE_ORDER = defineFeatureOrder<CapabilityFeatureKey>()([
  "roadmap",
  "changelog",
  "unlimitedEndUsers",
  "unlimitedPosts",
  "privateBoards",
  "removeBranding",
] as const);

export const PLAN_ENTITLEMENTS = {
  free: {
    limits: {
      feedbackBoards: 2,
      privilegedMembers: 2,
    },
    capabilities: {
      roadmap: true,
      changelog: true,
      unlimitedEndUsers: true,
      unlimitedPosts: true,
      privateBoards: false,
      removeBranding: false,
    },
  },
  starter: {
    limits: {
      feedbackBoards: 5,
      privilegedMembers: 5,
    },
    capabilities: {
      roadmap: true,
      changelog: true,
      unlimitedEndUsers: true,
      unlimitedPosts: true,
      privateBoards: true,
      removeBranding: true,
    },
  },
  professional: {
    limits: {
      feedbackBoards: null,
      privilegedMembers: null,
    },
    capabilities: {
      roadmap: true,
      changelog: true,
      unlimitedEndUsers: true,
      unlimitedPosts: true,
      privateBoards: true,
      removeBranding: true,
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
