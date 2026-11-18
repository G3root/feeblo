import {
  type LimitFeatureKey,
  PLAN_FEATURE_CATALOG,
} from "@feeblo/domain/plan-entitlements";
import { isLiveQueryFailed } from "@feeblo/web-shared/collections";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { eq, useLiveQuery } from "@tanstack/react-db";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { useChangelogCategories } from "./use-changelog-categories";
import { useEntitlements } from "./use-entitlements";
import { useOrgBoards } from "./use-org-boards";
import { useOrgCompanies } from "./use-org-companies";
import { useOrgContacts } from "./use-org-contacts";
import { useOrgInvitations } from "./use-org-invitations";
import { useOrgMembers } from "./use-org-members";
import { useOrganizationId } from "./use-organization-id";

/**
 * The workspace-scoped limits a usage meter can count.
 *
 * `workspaces` is deliberately absent: it caps how many free workspaces one
 * owner may create, so it is an account-level limit rather than something this
 * workspace consumes. It still appears in the plan comparison table.
 */
export type WorkspaceUsageKey = Extract<
  LimitFeatureKey,
  | "feedbackBoards"
  | "members"
  | "changelogCategories"
  | "helpCenterArticles"
  | "crmEntries"
>;

export type WorkspaceUsageRow = {
  readonly key: WorkspaceUsageKey;
  readonly label: string;
  readonly used: number;
  readonly limit: number | null;
  readonly isLoading: boolean;
  readonly isUnavailable: boolean;
};

type UsageCount = {
  readonly used: number;
  readonly isLoading: boolean;
  readonly isUnavailable: boolean;
};

const usageRow = ({
  isUnavailable,
  isLoading,
  key,
  limit,
  used,
}: {
  readonly isUnavailable: boolean;
  readonly isLoading: boolean;
  readonly key: WorkspaceUsageKey;
  readonly limit: number | null;
  readonly used: number;
}): WorkspaceUsageRow => ({
  key,
  label: PLAN_FEATURE_CATALOG[key].pluralLabel,
  used,
  limit,
  isLoading,
  isUnavailable,
});

/**
 * Seats this workspace has taken: members plus pending invitations.
 *
 * A pending invitation holds a seat before it is accepted, which is how the
 * server measures the member allowance. Listing invitations carries its own
 * grant, so the query stays disabled until the viewer holds it.
 */
function useMemberSeatCount(organizationId: string): UsageCount {
  const { allowed: canListInvitations, isPending: isPolicyPending } = usePolicy(
    hasPermission(organizationId, "members.invite")
  );

  const members = useOrgMembers(organizationId);

  const invitations = useOrgInvitations({
    organizationId,
    enabled: !isPolicyPending && canListInvitations,
  });

  return {
    used: (members.data ?? []).length + (invitations.data ?? []).length,
    isLoading: isPolicyPending || members.isLoading || invitations.isLoading,
    isUnavailable: isLiveQueryFailed(members) || isLiveQueryFailed(invitations),
  };
}

/** CRM contacts and companies count against one allowance on the server. */
function useCrmEntryCount(organizationId: string): UsageCount {
  const contacts = useOrgContacts(organizationId);
  const companies = useOrgCompanies(organizationId);

  return {
    used: (contacts.data ?? []).length + (companies.data ?? []).length,
    isLoading: contacts.isLoading || companies.isLoading,
    isUnavailable: isLiveQueryFailed(contacts) || isLiveQueryFailed(companies),
  };
}

function useHelpArticleCount(organizationId: string): UsageCount {
  const { helpCenterArticleCollection } = useDashboardCollections();

  const query = useLiveQuery({
    // Distinct from the help center index's key because this subscription has
    // no ordering; sharing a key would hand one surface the other's shape.
    queryKey: [
      "billing-usage-help-articles",
      helpCenterArticleCollection.id,
      organizationId,
    ],
    query: (q) =>
      q
        .from({ article: helpCenterArticleCollection })
        .where(({ article }) => eq(article.organizationId, organizationId)),
  });

  return {
    used: (query.data ?? []).length,
    isLoading: query.isLoading,
    isUnavailable: isLiveQueryFailed(query),
  };
}

/**
 * What this workspace consumes against its plan limits.
 *
 * Counts come from the same live collections the feature pages render, so a
 * meter updates when a board, member, category, article, or CRM entry is added
 * elsewhere in the dashboard. The allowances come from `PLAN_ENTITLEMENTS`
 * through `useEntitlements`, which is the table the server enforces, so the
 * card explains the limit a request would actually hit.
 */
export function useWorkspaceUsage(): readonly WorkspaceUsageRow[] {
  const organizationId = useOrganizationId();
  const { entitlements } = useEntitlements();

  const boards = useOrgBoards(organizationId);
  const categories = useChangelogCategories(organizationId);
  const members = useMemberSeatCount(organizationId);
  const helpArticles = useHelpArticleCount(organizationId);
  const crmEntries = useCrmEntryCount(organizationId);

  const limits = entitlements.limits;

  return [
    usageRow({
      key: "feedbackBoards",
      limit: limits.feedbackBoards,
      used: (boards.data ?? []).length,
      isLoading: boards.isLoading,
      isUnavailable: isLiveQueryFailed(boards),
    }),
    usageRow({ key: "members", limit: limits.members, ...members }),
    usageRow({
      key: "changelogCategories",
      limit: limits.changelogCategories,
      used: (categories.data ?? []).length,
      isLoading: categories.isLoading,
      isUnavailable: isLiveQueryFailed(categories),
    }),
    usageRow({
      key: "helpCenterArticles",
      limit: limits.helpCenterArticles,
      ...helpArticles,
    }),
    usageRow({ key: "crmEntries", limit: limits.crmEntries, ...crmEntries }),
  ];
}
