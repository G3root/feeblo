import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { SkeletonLoader } from "@feeblo/ui/skeleton-loader";
import { and, eq, ilike, inArray, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import type { ChangelogStatus } from "~/features/changelog/constants";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import { useChangelogAction } from "../hooks/use-changelog-action";
import {
  ChangelogStoreProvider,
  useChangelogStore,
} from "../state/changelog-store-context";
import { ChangelogListView } from "./changelog-list-view";
import { ChangelogToolbar } from "./changelog-toolbar";

const FILTER_LABELS: Record<"all" | ChangelogStatus, string> = {
  all: "changelog entries",
  draft: "draft changelog entries",
  scheduled: "scheduled changelog entries",
  published: "published changelog entries",
};

export function ChangelogIndex({
  organizationId,
  statuses,
}: {
  organizationId: string;
  statuses?: ChangelogStatus[];
}) {
  return (
    <ChangelogStoreProvider
      defaultValue={{
        filters: {
          statuses: statuses ?? [],
        },
      }}
    >
      <ChangelogIndexContent organizationId={organizationId} />
    </ChangelogStoreProvider>
  );
}

function ChangelogIndexContent({ organizationId }: { organizationId: string }) {
  const { changelogCollection } = useDashboardCollections();
  const { createChangeLog, canCreate } = useChangelogAction();
  const store = useChangelogStore();
  const search = useSelector(store, (s) => s.context.filters.search);
  const statuses = useSelector(store, (s) => s.context.filters.statuses);

  const normalizedSearch = search.trim();
  const statusesKey = statuses.join(",");

  const changelogsQuery = useLiveQuery(
    (q) =>
      q
        .from({ changelog: changelogCollection })
        .where(({ changelog }) => {
          let condition = eq(changelog.organizationId, organizationId);

          if (statuses.length > 0) {
            condition = and(condition, inArray(changelog.status, statuses));
          }

          if (normalizedSearch) {
            condition = and(
              condition,
              ilike(changelog.title, `%${normalizedSearch}%`)
            );
          }

          return condition;
        })
        .orderBy(({ changelog }) => changelog.updatedAt, "desc"),
    [organizationId, statusesKey, normalizedSearch]
  );
  const visibleChangelogs = changelogsQuery.data ?? [];
  const filterLabel =
    statuses.length === 1 ? FILTER_LABELS[statuses[0]] : FILTER_LABELS.all;
  const hasSearchFilter = normalizedSearch.length > 0;
  const emptyTitle = hasSearchFilter
    ? `No ${filterLabel} match this search`
    : `No ${filterLabel} yet`;
  const emptyDescription = getEmptyDescription({
    hasSearchFilter,
    statusesLength: statuses.length,
  });

  if (changelogsQuery.isError) {
    return (
      <div className="mx-auto w-full">
        <ChangelogToolbar />
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Changelog unavailable</EmptyTitle>
            <EmptyDescription>
              There was a problem loading {filterLabel}.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  if (!changelogsQuery.isLoading && visibleChangelogs.length === 0) {
    return (
      <div className="mx-auto w-full">
        <ChangelogToolbar />
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{emptyTitle}</EmptyTitle>
            <EmptyDescription>{emptyDescription}</EmptyDescription>
            {canCreate && !hasSearchFilter ? (
              <EmptyContent>
                <Button onClick={createChangeLog} type="button">
                  Create your first entry
                </Button>
              </EmptyContent>
            ) : null}
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <SkeletonLoader isLoading={changelogsQuery.isLoading}>
      <div className="mx-auto w-full">
        <ChangelogToolbar />
        <ChangelogListView
          changelogs={visibleChangelogs ?? []}
          organizationId={organizationId}
        />
      </div>
    </SkeletonLoader>
  );
}

function getEmptyDescription({
  hasSearchFilter,
  statusesLength,
}: {
  hasSearchFilter: boolean;
  statusesLength: number;
}) {
  if (hasSearchFilter) {
    return "Try a different title search or clear the current filter.";
  }

  if (statusesLength === 1) {
    return "Create a new changelog entry or switch tabs to review entries in another state.";
  }

  return "Draft your first product update and publish it when it is ready.";
}
