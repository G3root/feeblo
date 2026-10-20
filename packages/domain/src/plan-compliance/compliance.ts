import type { LegidFrom, WorkspaceId } from "@feeblo/id";
import { isPrivilegedRole } from "@feeblo/permissions";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { BoardRepository } from "../board/repository";
import { ChangelogCategoryRepository } from "../changelog-category/repository";
import { CompanyRepository } from "../company/repository";
import { ContactRepository } from "../contact/repository";
import { countCrmEntries } from "../crm-entry/intake";
import { MembershipRepository } from "../membership/repository";
import {
  type CapabilityFeatureKey,
  type PlanEntitlements,
  PLAN_ENTITLEMENTS,
} from "../plan-entitlements";
import { PostRepository } from "../post/repository";
import { RoadmapRepository } from "../roadmap/repository";
import { WorkspaceRepository } from "../workspace/repository";
import type {
  TPlanComplianceResource,
  TPlanComplianceViolation,
  TWorkspacePlanCompliance,
} from "./schema";

/**
 * Rows the gate renders per violation. A workspace beyond the cap fixes the
 * first batch and reloads; the alternative is a modal with thousands of
 * delete buttons, which is not a remediation surface, it is a bulk-delete
 * tool nobody asked for.
 */
const RESOURCE_PREVIEW_LIMIT = 200;
const ADMIN_ROLE_PREVIEW_LIMIT = 100;
const CRM_RESOURCE_PREVIEW_LIMIT = 100;

/**
 * Capabilities the plan does not include. They already stop working at read
 * time, so the snapshot only reports them; there is nothing to remediate.
 */
const DEGRADED_CAPABILITIES = [
  "integrations",
  "publicApi",
  "removeBranding",
  "widgetSso",
  "subscriberEmails",
] as const satisfies readonly CapabilityFeatureKey[];

const postCountLabel = (total: number): string =>
  `${total} ${total === 1 ? "post" : "posts"}`;

const changelogCountLabel = (total: number): string =>
  `${total} ${total === 1 ? "changelog" : "changelogs"}`;

const roleLabel = (role: string): string =>
  role === "owner" ? "Owner" : "Admin";

const toBoardResources = (
  boards: ReadonlyArray<{ readonly id: string; readonly name: string }>,
  postCounts: Record<string, number>
): TPlanComplianceResource[] =>
  boards.map((board) => ({
    id: board.id,
    kind: "board",
    label: board.name,
    detail: postCountLabel(postCounts[board.id] ?? 0),
  }));

/**
 * The single definition of "over-plan": the plan the workspace is on against
 * the state it already holds.
 *
 * Counts run first and resource rows are fetched only for a finding that is
 * already over, so a compliant workspace (the common case, evaluated on every
 * dashboard entry) costs a handful of indexed counts and nothing else.
 *
 * `includeResources` is the caller's authorization decision, not a preference:
 * a member without `billing.*` gets the kinds and counts that explain the
 * block, but not the invitation addresses or resource labels.
 */
const makePlanCompliance = Effect.gen(function* () {
  const workspaceRepository = yield* WorkspaceRepository;
  const boardRepository = yield* BoardRepository;
  const roadmapRepository = yield* RoadmapRepository;
  const changelogCategoryRepository = yield* ChangelogCategoryRepository;
  const contactRepository = yield* ContactRepository;
  const companyRepository = yield* CompanyRepository;
  const membershipRepository = yield* MembershipRepository;
  const postRepository = yield* PostRepository;

  const snapshot = Effect.fn("PlanCompliance.snapshot")(function* (args: {
    readonly includeResources: boolean;
    readonly organizationId: LegidFrom<typeof WorkspaceId>;
  }) {
    const { organizationId } = args;
    const { plan } = yield* workspaceRepository.findPlanByOrganizationId({
      organizationId,
    });
    const entitlements: PlanEntitlements = PLAN_ENTITLEMENTS[plan];
    const { capabilities, limits } = entitlements;

    const [
      boardCount,
      privateBoardCount,
      privateRoadmapCount,
      changelogCategoryCount,
      privilegedMemberCount,
      pendingPrivilegedInvitationCount,
      crmEntryCount,
    ] = yield* Effect.all([
      boardRepository.countByOrganizationId({ organizationId }),
      boardRepository.countByVisibility({
        organizationId,
        visibility: "PRIVATE",
      }),
      roadmapRepository.countByVisibility({
        organizationId,
        visibility: "private",
      }),
      changelogCategoryRepository.countByOrganizationId({ organizationId }),
      membershipRepository.countPrivilegedMembers({ organizationId }),
      membershipRepository.countPendingPrivilegedInvitations({
        organizationId,
      }),
      countCrmEntries(organizationId),
    ]);

    const violations: TPlanComplianceViolation[] = [];

    const hasPrivateBoards =
      !capabilities.privateBoards && privateBoardCount > 0;
    const overBoardLimit =
      limits.feedbackBoards !== null && boardCount > limits.feedbackBoards;

    if (hasPrivateBoards || overBoardLimit) {
      const boards =
        args.includeResources && overBoardLimit
          ? yield* boardRepository.findMany({ organizationId })
          : [];
      const preview = boards.slice(0, RESOURCE_PREVIEW_LIMIT);

      // A private board can sit beyond the general board preview. Fetch the
      // private page separately so the finding always has rows to act on, and
      // count posts over the union so both previews share one query.
      const privateBoards =
        args.includeResources && hasPrivateBoards
          ? yield* boardRepository.findMany({
              organizationId,
              visibility: "PRIVATE",
            })
          : [];
      const privatePreview = privateBoards.slice(0, RESOURCE_PREVIEW_LIMIT);

      const postCounts = args.includeResources
        ? yield* postRepository.countByBoardIds({
            boardIds: [
              ...new Set(
                [...preview, ...privatePreview].map((board) => board.id)
              ),
            ],
            organizationId,
          })
        : {};

      if (hasPrivateBoards) {
        violations.push({
          kind: "privateBoards",
          count: privateBoardCount,
          limit: null,
          resources: args.includeResources
            ? toBoardResources(privatePreview, postCounts)
            : [],
        });
      }

      if (overBoardLimit) {
        violations.push({
          kind: "boards",
          count: boardCount,
          limit: limits.feedbackBoards,
          resources: args.includeResources
            ? toBoardResources(preview, postCounts)
            : [],
        });
      }
    }

    if (!capabilities.privateRoadmaps && privateRoadmapCount > 0) {
      const roadmaps = args.includeResources
        ? yield* roadmapRepository.findMany({
            organizationId,
            visibility: "private",
          })
        : [];

      violations.push({
        kind: "privateRoadmaps",
        count: privateRoadmapCount,
        limit: null,
        resources: args.includeResources
          ? roadmaps.slice(0, RESOURCE_PREVIEW_LIMIT).map((roadmap) => ({
              id: roadmap.id,
              kind: "roadmap",
              label: roadmap.name,
              detail: roadmap.isPrimary ? "Primary roadmap" : null,
            }))
          : [],
      });
    }

    const adminRoleCount =
      privilegedMemberCount + pendingPrivilegedInvitationCount;

    if (
      limits.privilegedMembers !== null &&
      adminRoleCount > limits.privilegedMembers
    ) {
      const [members, invitations] = args.includeResources
        ? yield* Effect.all([
            membershipRepository.findOrganizationMembers({ organizationId }),
            membershipRepository.findOrganizationInvitations({
              organizationId,
            }),
          ])
        : [[], []];

      const resources: TPlanComplianceResource[] = [
        ...members
          .filter((member) => isPrivilegedRole(member.role))
          .map((member) => ({
            id: member.id,
            kind: "member" as const,
            label: member.user.name.trim() || member.user.email,
            detail: roleLabel(member.role),
          })),
        ...invitations
          .filter((invitation) => isPrivilegedRole(invitation.role ?? ""))
          .map((invitation) => ({
            id: invitation.id,
            kind: "invitation" as const,
            label: invitation.email,
            detail: `Pending invitation · ${roleLabel(invitation.role ?? "")}`,
          })),
      ]
        .sort((left, right) => left.label.localeCompare(right.label))
        .slice(0, ADMIN_ROLE_PREVIEW_LIMIT);

      violations.push({
        kind: "adminRoles",
        count: adminRoleCount,
        limit: limits.privilegedMembers,
        resources: args.includeResources ? resources : [],
      });
    }

    if (
      limits.changelogCategories !== null &&
      changelogCategoryCount > limits.changelogCategories
    ) {
      const categories = args.includeResources
        ? yield* changelogCategoryRepository.findMany({ organizationId })
        : [];
      const preview = categories.slice(0, RESOURCE_PREVIEW_LIMIT);
      const linkCounts = args.includeResources
        ? yield* changelogCategoryRepository.countLinksByCategoryIds({
            categoryIds: preview.map((category) => category.id),
            organizationId,
          })
        : {};

      violations.push({
        kind: "changelogCategories",
        count: changelogCategoryCount,
        limit: limits.changelogCategories,
        resources: args.includeResources
          ? preview.map((category) => ({
              id: category.id,
              kind: "changelogCategory",
              label: category.name,
              detail: changelogCountLabel(linkCounts[category.id] ?? 0),
            }))
          : [],
      });
    }

    if (limits.crmEntries !== null && crmEntryCount > limits.crmEntries) {
      const contacts = args.includeResources
        ? yield* contactRepository.findManyContacts(organizationId, {
            limit: CRM_RESOURCE_PREVIEW_LIMIT,
          })
        : [];
      const companies = args.includeResources
        ? yield* companyRepository.findManyCompanies(organizationId, {
            limit: CRM_RESOURCE_PREVIEW_LIMIT,
          })
        : [];

      const resources: TPlanComplianceResource[] = [
        ...contacts.map((contact) => ({
          id: contact.id,
          kind: "contact" as const,
          label: contact.name?.trim() || contact.email || contact.id,
          detail: contact.name?.trim() ? contact.email : null,
        })),
        ...companies.map((company) => ({
          id: company.id,
          kind: "company" as const,
          label: company.name,
          detail: null,
        })),
      ]
        .sort((left, right) => left.label.localeCompare(right.label))
        .slice(0, CRM_RESOURCE_PREVIEW_LIMIT);

      violations.push({
        kind: "crmEntries",
        count: crmEntryCount,
        limit: limits.crmEntries,
        resources: args.includeResources ? resources : [],
      });
    }

    return {
      organizationId,
      plan,
      violations,
      degraded: DEGRADED_CAPABILITIES.filter(
        (capability) => !capabilities[capability]
      ),
    } satisfies TWorkspacePlanCompliance;
  });

  return { snapshot };
});

export class PlanCompliance extends Context.Service<PlanCompliance>()(
  "PlanCompliance",
  {
    make: makePlanCompliance,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
