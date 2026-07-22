import { buttonVariants } from "@feeblo/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { cn } from "@feeblo/ui/utils";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createLazyRoute, Link, useParams } from "@tanstack/react-router";
import {
  ChangelogPageLayout,
  ChangelogStickyRail,
  ChangelogTimelineBody,
  ChangelogTimelineItem,
  formatChangelogDate,
} from "../components/changelog/changelog-layout";
import { formatPostStatus } from "../lib/utils";
import { usePublicCollections } from "../providers/public-collections-provider";
import { useSite } from "../providers/site-provider";

export const Route = createLazyRoute("/changelog/$changelogSlug")({
  component: ChangeLogDetailPage,
});

export function ChangeLogDetailPage() {
  const site = useSite();
  const { changelogSlug } = useParams({ from: "/changelog/$changelogSlug" });
  const {
    publicChangelogCollection,
    publicChangelogPostCollection,
    publicPostCollection,
    publicPostStatusCollection,
  } = usePublicCollections();
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

  const {
    data: linkedPosts = [],
    isError: isLinkedPostsError,
    isLoading: isLinkedPostsLoading,
  } = useLiveQuery(
    (q) => {
      if (!changelog) {
        return undefined;
      }

      return q
        .from({ link: publicChangelogPostCollection })
        .innerJoin({ post: publicPostCollection }, ({ link, post }) =>
          eq(link.postId, post.id)
        )
        .innerJoin({ status: publicPostStatusCollection }, ({ post, status }) =>
          eq(post.statusId, status.id)
        )
        .where(({ link }) => eq(link.changelogId, changelog.id))
        .orderBy(({ link }) => link.createdAt, "desc")
        .select(({ post, status }) => ({
          id: post.id,
          slug: post.slug,
          status: status.type,
          title: post.title,
        }));
    },
    [changelog?.id]
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
            <HugeiconsIcon icon={ArrowLeft01Icon} />
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

          {isLinkedPostsError ? (
            <p className="text-muted-foreground text-sm">
              Linked posts are unavailable.
            </p>
          ) : isLinkedPostsLoading ? (
            <p className="text-muted-foreground text-sm">Loading linked posts...</p>
          ) : linkedPosts.length > 0 ? (
            <section aria-labelledby="linked-posts-heading" className="space-y-3">
              <h2 className="font-semibold text-xl tracking-tight" id="linked-posts-heading">
                Linked posts
              </h2>
              <div className="divide-y rounded-xl border">
                {linkedPosts.map((post) => (
                  <Link
                    className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/40"
                    key={post.id}
                    params={{ slug: post.slug }}
                    to="/p/$slug"
                  >
                    <span className="min-w-0 truncate font-medium text-sm">
                      {post.title}
                    </span>
                    <span className="shrink-0 text-muted-foreground text-xs">
                      {formatPostStatus(post.status)}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </ChangelogTimelineBody>
      </ChangelogTimelineItem>
    </ChangelogPageLayout>
  );
}
