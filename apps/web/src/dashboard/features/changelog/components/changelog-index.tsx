import { generateId } from "@feeblo/utils/id";
import { slugify } from "@feeblo/utils/url";
import { and, eq, inArray, useLiveQuery } from "@tanstack/react-db";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { SkeletonLoader } from "~/components/ui/skeleton-loader";
import { toastManager } from "~/components/ui/toast";
import type { ChangelogStatus } from "~/features/changelog/constants";
import { hasMembership, usePolicy } from "~/hooks/use-policy";
import { authClient } from "~/lib/auth-client";
import { changelogCollection, membersCollection } from "~/lib/collections";
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
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const { allowed: canCreate } = usePolicy(hasMembership(organizationId));

  const { data: member } = useLiveQuery(
    (q) => {
      if (!(organizationId && session?.user?.id)) {
        return undefined;
      }

      return q
        .from({ member: membersCollection })
        .where(({ member }) =>
          and(
            eq(member.organizationId, organizationId),
            eq(member.userId, session.user.id)
          )
        )
        .findOne();
    },
    [organizationId, session?.user?.id]
  );
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

  async function handleCreate() {
    if (!canCreate) {
      return;
    }

    try {
      const id = generateId("changelog");
      const title = "Untitled changelog";
      const slug = `${slugify(title) || "changelog"}-${id.slice(-6)}`;
      const tx = changelogCollection.insert({
        id,
        title,
        slug,
        content: "",
        status: "draft" as ChangelogStatus,
        scheduledAt: null,
        publishedAt: null,
        organizationId,
        creatorId: session?.user?.id ?? null,
        creatorMemberId: member?.id ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          name: session?.user?.name ?? null,
          image: session?.user?.image ?? null,
        },
      });

      await tx.isPersisted.promise;

      navigate({
        to: "/$organizationId/changelog/edit/$changelogSlug",
        params: { organizationId, changelogSlug: slug },
      });
    } catch (_error) {
      toastManager.add({
        title: "Failed to create changelog",
        type: "error",
      });
    }
  }

  if (changelogsQuery.isError) {
    return (
      <div className="mx-auto w-full">
        <ChangelogToolbar organizationId={organizationId} />
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
        <ChangelogToolbar organizationId={organizationId} />
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
                <Button onClick={handleCreate} type="button">
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
        <ChangelogToolbar organizationId={organizationId} />
        <ChangelogListView
          changelogs={visibleChangelogs ?? []}
          organizationId={organizationId}
        />
      </div>
    </SkeletonLoader>
  );
}
