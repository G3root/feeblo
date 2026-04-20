import { Schema } from "effect";

export const WorkspaceInput = Schema.Struct({
  organizationId: Schema.String,
});

export const WorkspacePlan = Schema.Struct({
  organizationId: Schema.String,
  plan: Schema.Literal("free", "starter", "professional"),
});

export class CreateWorkspaceInput extends Schema.Class<CreateWorkspaceInput>(
  "CreateWorkspaceInput"
)({
  workspaceName: Schema.String.pipe(Schema.minLength(3)),
}) {}

export class CreateWorkspaceOutput extends Schema.Class<CreateWorkspaceOutput>(
  "CreateWorkspaceOutput"
)({
  organizationId: Schema.String,
}) {}

export type TCreateWorkspaceInput = Schema.Schema.Type<
  typeof CreateWorkspaceInput
>;

export type TWorkspaceInput = Schema.Schema.Type<typeof WorkspaceInput>;
export type TWorkspacePlan = Schema.Schema.Type<typeof WorkspacePlan>;

export const WorkspacePreferences = Schema.Struct({
  allowMemberInvites: Schema.Boolean,
  defaultBoardVisibility: Schema.Literal("private", "public"),
  timezone: Schema.String,
});

export const Workspace = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  plan: Schema.Literal("free"),
  region: Schema.String,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
  memberCount: Schema.Number,
  boardCount: Schema.Number,
  siteCount: Schema.Number,
  preferences: WorkspacePreferences,
});

export type TWorkspace = Schema.Schema.Type<typeof Workspace>;

export const WorkspaceProductMetadata = Schema.Struct({
  plan: Schema.Literal("starter", "professional"),
});

export const WorkspaceProduct = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  trialInterval: Schema.NullOr(Schema.String),
  trialIntervalCount: Schema.NullOr(Schema.Number),
  recurringInterval: Schema.NullOr(Schema.Literal("month", "year")),
  recurringIntervalCount: Schema.NullOr(Schema.Number),
  isRecurring: Schema.Boolean,
  isArchived: Schema.Boolean,
  externalOrganizationId: Schema.String,
  visibility: Schema.String,
  prices: Schema.NullOr(Schema.Unknown),
  metadata: Schema.NullOr(WorkspaceProductMetadata),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});

export type TWorkspaceProduct = Schema.Schema.Type<typeof WorkspaceProduct>;
