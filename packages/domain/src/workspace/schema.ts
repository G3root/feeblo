import { LIMIT_FEATURE_KEYS } from "@feeblo/domain-contracts/plan";
import * as S from "effect/Schema";

export const WorkspaceInput = S.Struct({
  organizationId: S.String,
});

export const WorkspacePlan = S.Struct({
  organizationId: S.String,
  plan: S.Literals(["free", "starter", "professional"]),
});

export const CreateWorkspaceInput = S.Struct({
  workspaceName: S.String.pipe(S.check(S.isMinLength(3))),
});

export const CreateWorkspaceOutput = S.Struct({
  organizationId: S.String,
});

export const WorkspaceCreationState = S.Struct({
  canCreate: S.Boolean,
  reason: S.NullOr(S.String),
  freeWorkspaces: S.Array(
    S.Struct({
      id: S.String,
      name: S.String,
    })
  ),
});

export type TWorkspaceCreationState = S.Schema.Type<
  typeof WorkspaceCreationState
>;

export const WorkspaceSlugCheckInput = S.Struct({
  slug: S.String.pipe(S.check(S.isMinLength(4))),
});

export const WorkspaceSlugCheckOutput = S.Struct({
  available: S.Boolean,
  suggestion: S.NullOr(S.String),
  reason: S.NullOr(S.String),
});

export type TCreateWorkspaceInput = S.Schema.Type<typeof CreateWorkspaceInput>;
export type TWorkspaceInput = S.Schema.Type<typeof WorkspaceInput>;
export type TWorkspacePlan = S.Schema.Type<typeof WorkspacePlan>;

/**
 * One limit feature's plan-lock projection: how many resources the feature
 * counts, how many the plan allows, and which of them the gate blocks. The
 * kept set is the complement of `lockedIds` inside the resource list the
 * caller already has, so it is deliberately not sent: a Professional
 * workspace's CRM feature would otherwise ship every kept contact id.
 */
export const WorkspacePlanLockFeature = S.Struct({
  feature: S.Literals(LIMIT_FEATURE_KEYS),
  limit: S.NullOr(S.Finite),
  count: S.Finite,
  lockedIds: S.Array(S.String),
});

export const WorkspacePlanLockState = S.Struct({
  plan: S.Literals(["free", "starter", "professional"]),
  features: S.Array(WorkspacePlanLockFeature),
});

/**
 * `current` is the workspace's plan now; `preview` is the same evaluation on
 * the free plan, which is what the downgrade wizard shows while the workspace
 * is still paid.
 */
export const WorkspacePlanLock = S.Struct({
  current: WorkspacePlanLockState,
  preview: WorkspacePlanLockState,
});

export const WorkspacePlanLockSelectionInput = S.Struct({
  organizationId: S.String,
  featureKey: S.Literals(LIMIT_FEATURE_KEYS),
  resourceIds: S.Array(S.String),
});

export type TWorkspacePlanLock = S.Schema.Type<typeof WorkspacePlanLock>;
export type TWorkspacePlanLockSelectionInput = S.Schema.Type<
  typeof WorkspacePlanLockSelectionInput
>;
export type TWorkspaceSlugCheckInput = S.Schema.Type<
  typeof WorkspaceSlugCheckInput
>;
export type TWorkspaceSlugCheckOutput = S.Schema.Type<
  typeof WorkspaceSlugCheckOutput
>;

export const WorkspacePreferences = S.Struct({
  allowMemberInvites: S.Boolean,
  defaultBoardVisibility: S.Literals(["private", "public"]),
  timezone: S.String,
});

export const Workspace = S.Struct({
  id: S.String,
  name: S.String,
  slug: S.String,
  plan: S.Literal("free"),
  region: S.String,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
  memberCount: S.Finite,
  boardCount: S.Finite,
  siteCount: S.Finite,
  preferences: WorkspacePreferences,
});

export type TWorkspace = S.Schema.Type<typeof Workspace>;

export const WorkspaceProductMetadata = S.Struct({
  plan: S.Literals(["starter", "professional"]),
});

export const WorkspaceProduct = S.Struct({
  id: S.String,
  name: S.String,
  description: S.NullOr(S.String),
  trialInterval: S.NullOr(S.String),
  trialIntervalCount: S.NullOr(S.Finite),
  recurringInterval: S.NullOr(S.Literals(["month", "year"])),
  recurringIntervalCount: S.NullOr(S.Finite),
  isRecurring: S.Boolean,
  isArchived: S.Boolean,
  externalOrganizationId: S.String,
  visibility: S.String,
  prices: S.NullOr(S.Unknown),
  metadata: S.NullOr(WorkspaceProductMetadata),
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});

export type TWorkspaceProduct = S.Schema.Type<typeof WorkspaceProduct>;
