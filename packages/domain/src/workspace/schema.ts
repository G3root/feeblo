import * as S from "effect/Schema";

export const WorkspaceInput = S.Struct({
  organizationId: S.String,
});

export const WorkspacePlan = S.Struct({
  organizationId: S.String,
  plan: S.Literals(["free", "starter", "professional"]),
});

export const CreateWorkspaceInput = S.Struct({
  workspaceName: S.String.pipe(S.check(S.isMinLength(2))),
  /**
   * The subdomain the reader chose, not one derived from the name.
   *
   * Two names can want the same address, and a name that reads well in the
   * sidebar can make an address nobody wants to type. The check the field
   * shows (`CheckWorkspaceSlug`) and this field are the same string, so the
   * server validates rather than computes it.
   */
  subdomain: S.String.pipe(S.check(S.isMinLength(4))),
  /**
   * The boards the workspace starts with, in the order the reader picked them.
   * At least one, because the sample posts need somewhere to land and an
   * empty board list is a state the empty dashboard already covers.
   */
  boardNames: S.Array(S.String).pipe(
    S.check(S.isMinLength(1)),
    // A guard, not the policy: the handler enforces the plan's own allowance
    // and names the plan in the error. This only stops a hostile request from
    // reaching that check with ten thousand rows.
    S.check(S.isMaxLength(10))
  ),
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
