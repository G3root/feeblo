import { and, eq, inArray, useLiveQuery } from "@tanstack/react-db";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { SkeletonLoader } from "~/components/ui/skeleton-loader";
import type { ChangelogStatus } from "~/features/changelog/constants";
import { changelogCollection } from "~/lib/collections";
import { useChangelogAction } from "../hooks/use-changelog-action";
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
  const { createChangeLog, canCreate } = useChangelogAction();

  const statusesKey = statuses?.join(",") ?? "";

  const changelogsQuery = useLiveQuery(
    (q) =>
      q
        .from({ changelog: changelogCollection })
        .where(({ changelog }) => {
          let condition = eq(changelog.organizationId, organizationId);

          if (statuses?.length) {
            condition = and(condition, inArray(changelog.status, statuses));
          }

          return condition;
        })
        .orderBy(({ changelog }) => changelog.updatedAt, "desc"),
    [organizationId, statusesKey]
  );
  const visibleChangelogs = changelogsQuery.data ?? [];
  const filterLabel =
    statuses?.length === 1 ? FILTER_LABELS[statuses[0]] : FILTER_LABELS.all;

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
            <EmptyTitle>No {filterLabel} yet</EmptyTitle>
            <EmptyDescription>
              {statuses?.length === 1
                ? "Create a new changelog entry or switch tabs to review entries in another state."
                : "Draft your first product update and publish it when it is ready."}
            </EmptyDescription>
            {canCreate ? (
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
