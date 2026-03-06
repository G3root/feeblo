import { Schema } from "effect";

export const WorkspaceInput = Schema.Struct({
  organizationId: Schema.String,
});

export type TWorkspaceInput = Schema.Schema.Type<typeof WorkspaceInput>;

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

export const WorkspaceSubscription = Schema.Struct({
  id: Schema.String,
  externalId: Schema.String,
  organizationId: Schema.String,
  amount: Schema.Number,
  cancelAtPeriodEnd: Schema.Boolean,
  currency: Schema.String,
  recurringInterval: Schema.String,
  recurringIntervalCount: Schema.Number,
  status: Schema.String,
  currentPeriodStart: Schema.Date,
  currentPeriodEnd: Schema.NullOr(Schema.Date),
  trialStart: Schema.NullOr(Schema.Date),
  trialEnd: Schema.NullOr(Schema.Date),
  canceledAt: Schema.NullOr(Schema.Date),
  startedAt: Schema.NullOr(Schema.Date),
  endsAt: Schema.NullOr(Schema.Date),
  endedAt: Schema.NullOr(Schema.Date),
  customerId: Schema.String,
  productId: Schema.String,
  discountId: Schema.NullOr(Schema.String),
  checkoutId: Schema.NullOr(Schema.String),
  seats: Schema.NullOr(Schema.Number),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});

export type TWorkspaceSubscription = Schema.Schema.Type<
  typeof WorkspaceSubscription
>;
