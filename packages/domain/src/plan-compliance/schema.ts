import { WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

/**
 * The dashboard-internal view of a workspace's over-plan state.
 *
 * This is not the Public API vocabulary and carries no stability promise. It
 * names internal ids because the remediation surface acts on the rows it
 * returns, not on names.
 */
export const PlanComplianceInput = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type TPlanComplianceInput = S.Schema.Type<typeof PlanComplianceInput>;

/** Mirrors `OrganizationPlan`; `plan-entitlements.test.ts` pins the catalog. */
export const PlanCompliancePlan = S.Literals([
  "free",
  "starter",
  "professional",
]);

export const PlanComplianceResourceKind = S.Literals([
  "board",
  "roadmap",
  "member",
  "invitation",
  "changelogCategory",
  "contact",
  "company",
]);

/**
 * One row the gate can act on. `detail` is display copy — a post count, a
 * role, a pending-invitation marker — and may be null when there is nothing
 * useful to say.
 */
export const PlanComplianceResource = S.Struct({
  id: S.String,
  kind: PlanComplianceResourceKind,
  label: S.String,
  detail: S.NullOr(S.String),
});

export type TPlanComplianceResource = S.Schema.Type<
  typeof PlanComplianceResource
>;

export const PlanComplianceViolationKind = S.Literals([
  "privateBoards",
  "privateRoadmaps",
  "boards",
  "adminRoles",
  "changelogCategories",
  "crmEntries",
]);

/**
 * One entitlement finding.
 *
 * `count` is the total the plan is measured against, so a truncated
 * `resources` preview still tells the truth about how far over the workspace
 * is. `limit` is null for capabilities (private surfaces) that have no count.
 */
export const PlanComplianceViolation = S.Struct({
  kind: PlanComplianceViolationKind,
  count: S.Int,
  limit: S.NullOr(S.Int),
  resources: S.Array(PlanComplianceResource),
});

export type TPlanComplianceViolation = S.Schema.Type<
  typeof PlanComplianceViolation
>;

/**
 * Capabilities the current plan does not include. They already stop working
 * at read time, so they are explained in the gate rather than remediated.
 */
export const PlanComplianceDegradedCapability = S.Literals([
  "integrations",
  "publicApi",
  "removeBranding",
  "widgetSso",
  "subscriberEmails",
]);

export type TPlanComplianceDegradedCapability = S.Schema.Type<
  typeof PlanComplianceDegradedCapability
>;

export const WorkspacePlanCompliance = S.Struct({
  organizationId: S.String,
  plan: PlanCompliancePlan,
  violations: S.Array(PlanComplianceViolation),
  degraded: S.Array(PlanComplianceDegradedCapability),
});

export type TWorkspacePlanCompliance = S.Schema.Type<
  typeof WorkspacePlanCompliance
>;
