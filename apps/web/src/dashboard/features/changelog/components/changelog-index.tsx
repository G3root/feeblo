import { generateId } from "@feeblo/utils/id";
import { slugify } from "@feeblo/utils/url";
import {
  and,
  eq,
  useLiveQuery,
  useLiveSuspenseQuery,
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
import { toastManager } from "~/components/ui/toast";
import type { ChangelogStatus } from "~/features/changelog/constants";
import { hasMembership, usePolicy } from "~/hooks/use-policy";
import { authClient } from "~/lib/auth-client";
import { changelogCollection, membersCollection } from "~/lib/collections";
import { ChangelogListView } from "./changelog-list-view";

export function ChangelogIndex({ organizationId }: { organizationId: string }) {
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

  const { data: changelogs = [] } = useLiveSuspenseQuery(
    (q) =>
      q
        .from({ changelog: changelogCollection })
        .where(({ changelog }) => eq(changelog.organizationId, organizationId))
        .orderBy(({ changelog }) => changelog.updatedAt, "desc"),
    [organizationId]
  );

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
        to: "/$organizationId/changelog/$changelogSlug",
        params: { organizationId, changelogSlug: slug },
      });
    } catch (_error) {
      toastManager.add({
        title: "Failed to create changelog",
        type: "error",
      });
    }
  }

  return (
    <div className="mx-auto w-full">
      <section className="overflow-hidden text-card-foreground">
        <div className="space-y-6 border-b px-4 py-6 lg:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <h1 className="font-semibold text-3xl tracking-tight">
                Changelog
              </h1>
              <p className="text-muted-foreground text-sm">
                Draft updates, schedule them, or publish them immediately.
              </p>
            </div>
            {canCreate ? (
              <Button onClick={handleCreate} type="button">
                New entry
              </Button>
            ) : null}
          </div>
        </div>

        {changelogs.length ? (
          <ChangelogListView
            changelogs={changelogs}
            organizationId={organizationId}
          />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No changelog entries yet</EmptyTitle>
              <EmptyDescription>
                Draft your first product update and publish it when it is ready.
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
        )}
      </section>
    </div>
  );
}

export function ChangelogIndexPending() {
  return (
    <div className="mx-auto w-full">
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
        <div className="grid gap-4 px-4 py-4 md:grid-cols-2 lg:px-6 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div className="space-y-3 border-b pb-4" key={index}>
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
