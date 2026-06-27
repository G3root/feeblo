import { Schema as S } from "effect";

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

export const WorkspaceSlugCheckInput = S.Struct({
  slug: S.String.pipe(S.check(S.isMinLength(4))),
});

export const WorkspaceSlugCheckOutput = S.Struct({
  available: S.Boolean,
  suggestion: S.NullOr(S.String),
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
  memberCount: S.Number,
  boardCount: S.Number,
  siteCount: S.Number,
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
  trialIntervalCount: S.NullOr(S.Number),
  recurringInterval: S.NullOr(S.Literals(["month", "year"])),
  recurringIntervalCount: S.NullOr(S.Number),
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
