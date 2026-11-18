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
  /**
   * True when this was the user's first owned workspace, so the caller knows
   * to open the welcome tour the workspace is created with sample data for.
   * Decided inside the create transaction, under the same user-row lock that
   * makes the workspace cap authoritative, rather than by a second count a
   * concurrent create could invalidate.
   */
  isFirstWorkspace: S.Boolean,
});

export const WorkspaceOnboardingSummary = S.Struct({
  /**
   * How many posts in the workspace still carry the sample marker. Zero means
   * the reader has deleted or rewritten every seeded post.
   */
  samplePostCount: S.Finite,
});

export type TWorkspaceOnboardingSummary = S.Schema.Type<
  typeof WorkspaceOnboardingSummary
>;

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
