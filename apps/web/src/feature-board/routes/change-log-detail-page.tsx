import { buttonVariants } from "@feeblo/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createLazyRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { cn } from "~/lib/utils";
import {
  ChangelogPageLayout,
  ChangelogStickyRail,
  ChangelogTimelineBody,
  ChangelogTimelineItem,
  formatChangelogDate,
} from "../components/changelog/changelog-layout";
import { usePublicCollections } from "../providers/public-collections-provider";
import { useSite } from "../providers/site-provider";

//@ts-expect-error
export const Route = createLazyRoute("/changelog/$changelogSlug")({
  component: ChangeLogDetailPage,
});

export function ChangeLogDetailPage() {
  const site = useSite();
  const { changelogSlug } = useParams({ from: "/changelog/$changelogSlug" });
  const { publicChangelogCollection } = usePublicCollections();
  const {
    data: changelog,
    isLoading,
    isError,
  } = useLiveQuery(
    (q) =>
      q
        .from({ changelog: publicChangelogCollection })
        .where(({ changelog }) =>
          and(
            eq(changelog.organizationId, site.organizationId),
            eq(changelog.slug, changelogSlug)
          )
        )
        .findOne(),
    [site.organizationId, changelogSlug]
  );

  if (isLoading) {
    return <ChangelogPageLayout>Loading changelog...</ChangelogPageLayout>;
  }

  if (isError) {
    return (
      <ChangelogPageLayout>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Changelog unavailable</EmptyTitle>
            <EmptyDescription>
              There was a problem loading this published changelog.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ChangelogPageLayout>
    );
  }

  if (!changelog) {
    return (
      <ChangelogPageLayout>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Changelog not found</EmptyTitle>
            <EmptyDescription>
              This published changelog entry does not exist anymore.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ChangelogPageLayout>
    );
  }

  return (
    <ChangelogPageLayout>
      <ChangelogTimelineItem>
        <ChangelogStickyRail>
          <Link
            className={cn(
              buttonVariants({ size: "sm", variant: "ghost" }),
              "w-fit"
            )}
            to="/changelog"
          >
            <ArrowLeft />
            Back
          </Link>
        </ChangelogStickyRail>

        <ChangelogTimelineBody className="space-y-8">
          <header className="space-y-4">
            <p className="font-medium text-muted-foreground text-sm tracking-tight">
              {formatChangelogDate(
                changelog.publishedAt ?? changelog.createdAt
              )}
            </p>
            <div className="space-y-3">
              <h1 className="max-w-3xl font-semibold text-4xl tracking-tight sm:text-5xl">
                {changelog.title}
              </h1>
              <p className="text-muted-foreground text-sm">
                Published by {changelog.user.name ?? "Anonymous"}
              </p>
            </div>
          </header>

          <div
            className="typography"
            dangerouslySetInnerHTML={{ __html: changelog.content }}
          />
        </ChangelogTimelineBody>
      </ChangelogTimelineItem>
    </ChangelogPageLayout>
  );
}
