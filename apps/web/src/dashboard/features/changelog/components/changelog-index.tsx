import { generateId } from "@feeblo/utils/id";
import { slugify } from "@feeblo/utils/url";
import {
  and,
  eq,
  inArray,
  useLiveQuery,
} from "@tanstack/react-db";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
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

  if (changelogsQuery.isLoading) {
    return <ChangelogIndexPending organizationId={organizationId} />;
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

  if (visibleChangelogs.length === 0) {
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
    <div className="mx-auto w-full">
      <ChangelogToolbar organizationId={organizationId} />
      <ChangelogListView
        changelogs={visibleChangelogs}
        organizationId={organizationId}
      />
    </div>
  );
}

export function ChangelogIndexPending({
  organizationId,
}: {
  organizationId?: string;
} = {}) {
  return (
    <div className="mx-auto w-full">
      {organizationId ? (
        <ChangelogToolbar organizationId={organizationId} />
      ) : null}
      <section className="overflow-hidden text-card-foreground">
        <div className="space-y-6 border-b px-4 py-6 lg:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-72" />
            </div>
            <Skeleton className="h-9 w-28 rounded-md" />
          </div>
        </div>
        <div className="px-4 py-4 lg:px-6">
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Author</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Publish date</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 4 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Skeleton className="h-4 w-40" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-6 w-20 rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-36" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </section>
    </div>
  );
}
