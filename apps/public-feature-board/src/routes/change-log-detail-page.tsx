import { buttonVariants } from "@feeblo/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { MarkdownContent } from "@feeblo/ui/markdown-content";
import { cn } from "@feeblo/ui/utils";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createLazyRoute, Link, useParams } from "@tanstack/react-router";

import { ChangelogCategoryBadges } from "../components/changelog/changelog-category-badge";
import {
  ChangelogPageLayout,
  ChangelogStickyRail,
  ChangelogTimelineBody,
  ChangelogTimelineItem,
  formatChangelogDate,
} from "../components/changelog/changelog-layout";
import { ChangelogSubscribeButton } from "../components/changelog/changelog-subscribe-button";
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
    publicChangelogCategoryLinkCollection,
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

  const { data: categoryLinks = [] } = useLiveQuery(
    (q) => {
      if (!changelog) {
        return undefined;
      }

      return q
        .from({ link: publicChangelogCategoryLinkCollection })
        .where(({ link }) =>
          and(
            eq(link.changelogId, changelog.id),
            eq(link.organizationId, site.organizationId)
          )
        )
        .select(({ link }) => ({ categoryId: link.categoryId }));
    },
    [changelog?.id, site.organizationId]
  );
  const categoryIds = categoryLinks.map((link) => link.categoryId);

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
          {changelog.coverImage ? (
            <img
              alt=""
              className="aspect-[16/7] w-full rounded-xl border object-cover"
              height={525}
              src={changelog.coverImage}
              width={1200}
            />
          ) : null}
          <header className="space-y-4">
            <p className="text-muted-foreground text-sm font-medium tracking-tight">
              {formatChangelogDate(
                changelog.publishedAt ?? changelog.createdAt
              )}
            </p>
            <div className="space-y-3">
              <ChangelogCategoryBadges categoryIds={categoryIds} />
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
                {changelog.title}
              </h1>
              <p className="text-muted-foreground text-sm">
                Published by {changelog.user.name ?? "Anonymous"}
              </p>
            </div>
          </header>

          <MarkdownContent content={changelog.content} />

          <ChangelogSubscribeButton />

          {isLinkedPostsError ? (
            <p className="text-muted-foreground text-sm">
              Linked posts are unavailable.
            </p>
          ) : isLinkedPostsLoading ? (
            <p className="text-muted-foreground text-sm">
              Loading linked posts...
            </p>
          ) : linkedPosts.length > 0 ? (
            <section
              aria-labelledby="linked-posts-heading"
              className="space-y-3"
            >
              <h2
                className="text-xl font-semibold tracking-tight"
                id="linked-posts-heading"
              >
                Linked posts
              </h2>
              <div className="divide-y rounded-xl border">
                {linkedPosts.map((post) => (
                  <Link
                    className="hover:bg-muted/40 flex items-center justify-between gap-4 px-4 py-3 transition-colors"
                    key={post.id}
                    params={{ slug: post.slug }}
                    to="/p/$slug"
                  >
                    <span className="min-w-0 truncate text-sm font-medium">
                      {post.title}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs">
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
