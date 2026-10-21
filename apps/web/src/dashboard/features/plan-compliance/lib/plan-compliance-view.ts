import type {
  TPlanComplianceResource,
  TPlanComplianceViolation,
  TWorkspacePlanCompliance,
} from "@feeblo/domain/plan-compliance/schema";
import { PLAN_DISPLAY_NAMES } from "@feeblo/domain/plan-entitlements";
import { compareRoles, isRole, type Role } from "@feeblo/permissions";

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
  | "remove_member"
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
    | "members"
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

export type PlanComplianceViewOptions = {
  /**
   * The caller's role in this workspace, or null when they have none.
   *
   * Actions are filtered by it. The server refuses a write the actor's rank
   * does not allow, so the gate never renders a button that can only fail.
   */
  readonly actorRole: string | null;
};

const plural = (
  count: number,
  singular: string,
  pluralForm = `${singular}s`
): string => `${count} ${count === 1 ? singular : pluralForm}`;

const resourceKey = (resource: TPlanComplianceResource): string =>
  `${resource.kind}:${resource.id}`;

/**
 * The role the snapshot wrote into a member row's `detail`. The server labels
 * it by capitalizing the role, so the inverse is an exact lowercase. A detail
 * that is not a role yields null, and such a row offers no action rather than
 * one the server may refuse.
 */
const memberRole = (resource: TPlanComplianceResource): Role | null => {
  const role = resource.detail?.toLowerCase();
  return role !== undefined && isRole(role) ? role : null;
};

/**
 * The removal on offer for one member row: the action, and the detail line that
 * replaces the member's role when there is none.
 */
type MemberRemoval =
  | { readonly action: RemediationAction; readonly detail: null }
  | { readonly action: null; readonly detail: string | null };

/**
 * Decides whether this caller may remove this member.
 *
 * `RemoveOrganizationMember` requires the target to be ranked strictly below
 * the caller (`canManageTarget` in `membership/policies.ts`), and an owner
 * cannot be removed through team settings at all. A row the caller's rank does
 * not cover states who has to act instead of rendering a button that always
 * fails; a role the snapshot cannot name offers nothing, because an unknown
 * rank cannot be shown to outrank the target.
 */
const memberRemoval = (
  resource: TPlanComplianceResource,
  actorRole: string | null
): MemberRemoval => {
  const role = memberRole(resource);

  if (role === null) {
    return { action: null, detail: resource.detail };
  }

  if (role === "owner") {
    return {
      action: null,
      detail: "Owners cannot be removed from the workspace.",
    };
  }

  if (actorRole === null || !isRole(actorRole)) {
    return { action: null, detail: null };
  }

  if (compareRoles(role, actorRole) === -1) {
    return { action: removeMember(resource), detail: null };
  }

  return {
    action: null,
    // Owner is the only rank above admin, so this is the one block worth
    // naming: an admin cannot remove another admin.
    detail:
      role === "admin"
        ? "Only an owner can remove an admin."
        : "Only a member ranked above them can remove them.",
  };
};

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
});

const removeMember = (
  resource: TPlanComplianceResource
): RemediationAction => ({
  type: "remove_member",
  resourceId: resource.id,
  confirmationValue: resource.label,
  title: `Remove ${resource.label} from the workspace?`,
  description:
    "They lose access to this workspace immediately. Their posts, votes, and comments stay on the board.",
  confirmLabel: "Remove member",
  rowLabel: "Remove",
  successTitle: "Member removed",
  requiresTyping: false,
  destructive: true,
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
});

/**
 * Turns the entitlement-shaped snapshot into the resource-shaped sections the
 * gate renders.
 *
 * The snapshot reports findings per entitlement; a board can be in both the
 * `privateBoards` and `boards` findings, and the operator thinks about boards,
 * not entitlements. Sections are ordered by how much damage the fix does:
 * boards first, then roadmaps, members, categories, and CRM entries. A
 * finding with no resource rows (the caller cannot act) produces no section.
 */
export const buildPlanComplianceView = (
  compliance: TWorkspacePlanCompliance,
  { actorRole }: PlanComplianceViewOptions
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

  const members = violation(compliance, "members");

  if (members) {
    const rows = members.resources.map((resource) => {
      if (resource.kind !== "member") {
        return {
          key: resourceKey(resource),
          label: resource.label,
          detail: resource.detail,
          badges: [] as const,
          actions: [cancelInvitation(resource)],
        } satisfies PlanComplianceRow;
      }

      const { action, detail } = memberRemoval(resource, actorRole);

      return {
        key: resourceKey(resource),
        label: resource.label,
        // The role is already the badge, so the detail line carries the reason
        // a removal is not on offer.
        detail,
        badges: resource.detail ? [resource.detail] : [],
        actions: action === null ? [] : [action],
      } satisfies PlanComplianceRow;
    });

    if (rows.length > 0) {
      sections.push({
        key: "members",
        title: "Members",
        summary: `${plural(
          members.count,
          "member"
        )}. The ${planLabel} plan allows ${members.limit ?? "unlimited"}.`,
        truncated: members.count > rows.length,
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
