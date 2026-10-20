import type {
  TPlanComplianceResource,
  TPlanComplianceViolation,
  TWorkspacePlanCompliance,
} from "@feeblo/domain/plan-compliance/schema";
import { PLAN_DISPLAY_NAMES } from "@feeblo/domain/plan-entitlements";

/**
 * The write a remediation row performs. The snake_case spelling is also the
 * analytics property, so a new action cannot be added without naming it in the
 * event catalog as well.
 */
export type RemediationActionType =
  | "make_board_public"
  | "delete_board"
  | "make_roadmap_public"
  | "delete_roadmap"
  | "demote_admin"
  | "cancel_invitation"
  | "delete_changelog_category"
  | "delete_contact"
  | "delete_company";

export type RemediationAction = {
  readonly type: RemediationActionType;
  /** The row the action targets; also the value a typed confirmation must match. */
  readonly resourceId: string;
  readonly confirmationValue: string;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  /** The short label on the row's action button. */
  readonly rowLabel: string;
  readonly successTitle: string;
  /** Destructive row actions require the operator to type the resource name. */
  readonly requiresTyping: boolean;
  readonly destructive: boolean;
  /** Rank rules let only a workspace owner demote an admin. */
  readonly ownerOnly: boolean;
};

export type PlanComplianceRow = {
  readonly key: string;
  readonly label: string;
  readonly detail: string | null;
  readonly badges: readonly string[];
  readonly actions: readonly RemediationAction[];
};

export type PlanComplianceSection = {
  readonly key:
    | "boards"
    | "roadmaps"
    | "adminRoles"
    | "changelogCategories"
    | "crmEntries";
  readonly title: string;
  readonly summary: string;
  /** True when the snapshot's bounded preview omitted rows. */
  readonly truncated: boolean;
  readonly rows: readonly PlanComplianceRow[];
};

export type PlanComplianceView = {
  readonly planLabel: string;
  readonly sections: readonly PlanComplianceSection[];
};

const plural = (
  count: number,
  singular: string,
  pluralForm = `${singular}s`
): string => `${count} ${count === 1 ? singular : pluralForm}`;

const resourceKey = (resource: TPlanComplianceResource): string =>
  `${resource.kind}:${resource.id}`;

const violation = (
  compliance: TWorkspacePlanCompliance,
  kind: TPlanComplianceViolation["kind"]
): TPlanComplianceViolation | undefined =>
  compliance.violations.find((finding) => finding.kind === kind);

/**
 * Resources can appear in two findings (a private board is also a board), so
 * the gate merges by identity and keeps the first detail it saw.
 */
const mergeResources = (
  ...findings: ReadonlyArray<TPlanComplianceViolation | undefined>
): TPlanComplianceResource[] => {
  const byKey = new Map<string, TPlanComplianceResource>();

  for (const finding of findings) {
    for (const resource of finding?.resources ?? []) {
      if (!byKey.has(resourceKey(resource))) {
        byKey.set(resourceKey(resource), resource);
      }
    }
  }

  return [...byKey.values()];
};

const makeBoardPublic = (
  resource: TPlanComplianceResource
): RemediationAction => ({
  type: "make_board_public",
  resourceId: resource.id,
  confirmationValue: resource.label,
  title: `Make ${resource.label} public?`,
  description: `Anyone with the link can read this board${
    resource.detail ? ` and its ${resource.detail}` : ""
  }, including their voters. Making it private again later does not remove it from search-engine results.`,
  confirmLabel: "Make public",
  rowLabel: "Make public",
  successTitle: "Board is now public",
  requiresTyping: true,
  destructive: false,
  ownerOnly: false,
});

const deleteBoard = (resource: TPlanComplianceResource): RemediationAction => ({
  type: "delete_board",
  resourceId: resource.id,
  confirmationValue: resource.label,
  title: `Delete ${resource.label}?`,
  description: `This permanently deletes the board${
    resource.detail ? ` and its ${resource.detail}` : ""
  }, including comments and votes.`,
  confirmLabel: "Delete board",
  rowLabel: "Delete",
  successTitle: "Board deleted",
  requiresTyping: true,
  destructive: true,
  ownerOnly: false,
});

const makeRoadmapPublic = (
  resource: TPlanComplianceResource
): RemediationAction => ({
  type: "make_roadmap_public",
  resourceId: resource.id,
  confirmationValue: resource.label,
  title: `Make ${resource.label} public?`,
  description: "It becomes visible on the public roadmap.",
  confirmLabel: "Make public",
  rowLabel: "Make public",
  successTitle: "Roadmap is now public",
  requiresTyping: false,
  destructive: false,
  ownerOnly: false,
});

const deleteRoadmap = (
  resource: TPlanComplianceResource
): RemediationAction => ({
  type: "delete_roadmap",
  resourceId: resource.id,
  confirmationValue: resource.label,
  title: `Delete ${resource.label}?`,
  description:
    "The saved roadmap is removed. Posts that appear on it are not deleted.",
  confirmLabel: "Delete roadmap",
  rowLabel: "Delete",
  successTitle: "Roadmap deleted",
  requiresTyping: false,
  destructive: true,
  ownerOnly: false,
});

const demoteAdmin = (resource: TPlanComplianceResource): RemediationAction => ({
  type: "demote_admin",
  resourceId: resource.id,
  confirmationValue: resource.label,
  title: `Change ${resource.label} to manager?`,
  description:
    "They lose admin access immediately. You can promote them again after the workspace is back inside its plan.",
  confirmLabel: "Change role",
  rowLabel: "Change to manager",
  successTitle: "Admin changed to manager",
  requiresTyping: false,
  destructive: false,
  ownerOnly: true,
});

const cancelInvitation = (
  resource: TPlanComplianceResource
): RemediationAction => ({
  type: "cancel_invitation",
  resourceId: resource.id,
  confirmationValue: resource.label,
  title: `Cancel the invitation for ${resource.label}?`,
  description: "The invitation link stops working immediately.",
  confirmLabel: "Cancel invitation",
  rowLabel: "Cancel invitation",
  successTitle: "Invitation cancelled",
  requiresTyping: false,
  destructive: true,
  ownerOnly: false,
});

const deleteCategory = (
  resource: TPlanComplianceResource
): RemediationAction => ({
  type: "delete_changelog_category",
  resourceId: resource.id,
  confirmationValue: resource.label,
  title: `Delete ${resource.label}?`,
  description: `The category is removed${
    resource.detail ? ` from ${resource.detail}` : ""
  }. Entries it labels are kept.`,
  confirmLabel: "Delete category",
  rowLabel: "Delete",
  successTitle: "Category deleted",
  requiresTyping: true,
  destructive: true,
  ownerOnly: false,
});

const deleteContact = (
  resource: TPlanComplianceResource
): RemediationAction => ({
  type: "delete_contact",
  resourceId: resource.id,
  confirmationValue: resource.label,
  title: `Delete ${resource.label}?`,
  description:
    "Their posts and votes stay, but lose the author attribution this contact provided.",
  confirmLabel: "Delete contact",
  rowLabel: "Delete",
  successTitle: "Contact deleted",
  requiresTyping: true,
  destructive: true,
  ownerOnly: false,
});

const deleteCompany = (
  resource: TPlanComplianceResource
): RemediationAction => ({
  type: "delete_company",
  resourceId: resource.id,
  confirmationValue: resource.label,
  title: `Delete ${resource.label}?`,
  description:
    "The company record is removed. Its contacts keep their own records.",
  confirmLabel: "Delete company",
  rowLabel: "Delete",
  successTitle: "Company deleted",
  requiresTyping: true,
  destructive: true,
  ownerOnly: false,
});

/**
 * Turns the entitlement-shaped snapshot into the resource-shaped sections the
 * gate renders.
 *
 * The snapshot reports findings per entitlement; a board can be in both the
 * `privateBoards` and `boards` findings, and the operator thinks about boards,
 * not entitlements. Sections are ordered by how much damage the fix does:
 * boards first, then roadmaps, admin roles, categories, and CRM entries. A
 * finding with no resource rows (the caller cannot act) produces no section.
 */
export const buildPlanComplianceView = (
  compliance: TWorkspacePlanCompliance
): PlanComplianceView => {
  const planLabel = PLAN_DISPLAY_NAMES[compliance.plan];
  const sections: PlanComplianceSection[] = [];

  const boards = violation(compliance, "boards");
  const privateBoards = violation(compliance, "privateBoards");

  if (boards || privateBoards) {
    const privateIds = new Set(
      (privateBoards?.resources ?? []).map((resource) => resource.id)
    );
    const resources = mergeResources(boards, privateBoards);
    const rows = resources.map((resource) => {
      const isPrivate = privateIds.has(resource.id);

      return {
        key: resourceKey(resource),
        label: resource.label,
        detail: resource.detail,
        badges: isPrivate ? ["Private"] : [],
        actions: [
          ...(isPrivate ? [makeBoardPublic(resource)] : []),
          deleteBoard(resource),
        ],
      } satisfies PlanComplianceRow;
    });

    let summary: string;

    if (boards && privateIds.size > 0) {
      summary = `${boards.count} of ${boards.limit} boards, ${privateIds.size} of them private. The ${planLabel} plan allows ${boards.limit} boards and no private ones.`;
    } else if (boards) {
      summary = `${boards.count} of ${boards.limit} boards. The ${planLabel} plan allows ${boards.limit}.`;
    } else {
      summary = `${plural(
        privateIds.size,
        "private board"
      )}. The ${planLabel} plan does not include private boards.`;
    }

    if (rows.length > 0) {
      sections.push({
        key: "boards",
        title: "Feedback boards",
        summary,
        truncated:
          (boards?.count ?? privateBoards?.count ?? 0) > resources.length,
        rows,
      });
    }
  }

  const privateRoadmaps = violation(compliance, "privateRoadmaps");

  if (privateRoadmaps) {
    const rows = privateRoadmaps.resources.map((resource) => ({
      key: resourceKey(resource),
      label: resource.label,
      detail: resource.detail,
      badges: ["Private"] as const,
      actions: [makeRoadmapPublic(resource), deleteRoadmap(resource)],
    }));

    if (rows.length > 0) {
      sections.push({
        key: "roadmaps",
        title: "Roadmaps",
        summary: `${plural(
          privateRoadmaps.count,
          "private roadmap"
        )}. The ${planLabel} plan does not include private roadmaps.`,
        truncated: privateRoadmaps.count > rows.length,
        rows,
      });
    }
  }

  const adminRoles = violation(compliance, "adminRoles");

  if (adminRoles) {
    const rows = adminRoles.resources.map((resource) => {
      const isMember = resource.kind === "member";
      // The snapshot writes the member's role into `detail`; an owner cannot
      // be demoted by another owner, so that row has no action.
      const isOwner = isMember && resource.detail === "Owner";

      return {
        key: resourceKey(resource),
        label: resource.label,
        detail: resource.detail,
        badges: isMember ? (isOwner ? ["Owner"] : ["Admin"]) : [],
        actions: isMember
          ? isOwner
            ? []
            : [demoteAdmin(resource)]
          : [cancelInvitation(resource)],
      } satisfies PlanComplianceRow;
    });

    if (rows.length > 0) {
      sections.push({
        key: "adminRoles",
        title: "Admin roles",
        summary: `${plural(
          adminRoles.count,
          "admin role"
        )}. The ${planLabel} plan allows ${adminRoles.limit ?? "unlimited"}.`,
        truncated: adminRoles.count > rows.length,
        rows,
      });
    }
  }

  const changelogCategories = violation(compliance, "changelogCategories");

  if (changelogCategories) {
    const rows = changelogCategories.resources.map((resource) => ({
      key: resourceKey(resource),
      label: resource.label,
      detail: resource.detail,
      badges: [] as const,
      actions: [deleteCategory(resource)],
    }));

    if (rows.length > 0) {
      sections.push({
        key: "changelogCategories",
        title: "Changelog categories",
        summary: `${plural(
          changelogCategories.count,
          "changelog category",
          "changelog categories"
        )}. The ${planLabel} plan allows ${changelogCategories.limit ?? "unlimited"}.`,
        truncated: changelogCategories.count > rows.length,
        rows,
      });
    }
  }

  const crmEntries = violation(compliance, "crmEntries");

  if (crmEntries) {
    const rows = crmEntries.resources.map((resource) => ({
      key: resourceKey(resource),
      label: resource.label,
      detail: resource.detail,
      badges: resource.kind === "company" ? ["Company"] : ["Contact"],
      actions: [
        resource.kind === "company"
          ? deleteCompany(resource)
          : deleteContact(resource),
      ],
    }));

    if (rows.length > 0) {
      sections.push({
        key: "crmEntries",
        title: "CRM entries",
        summary: `${plural(
          crmEntries.count,
          "CRM entry",
          "CRM entries"
        )}. The ${planLabel} plan allows ${crmEntries.limit ?? "unlimited"}.`,
        truncated: crmEntries.count > rows.length,
        rows,
      });
    }
  }

  return { planLabel, sections };
};
