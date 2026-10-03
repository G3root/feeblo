import { buttonVariants } from "@feeblo/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { MarkdownContent } from "@feeblo/ui/markdown-content";
import { cn } from "@feeblo/ui/utils";
import { isLiveQueryPending } from "@feeblo/web-shared/collections";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { Link } from "@tanstack/react-router";

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
import { m } from "../paraglide/messages.js";
import { usePublicCollections } from "../providers/public-collections-provider";
import { useSite } from "../providers/site-provider";

export function ChangelogDetailPage({
  changelogSlug,
}: {
  readonly changelogSlug: string;
}) {
  const site = useSite();
  const {
    publicChangelogCategoryLinkCollection,
    publicChangelogDetailCollection,
  } = usePublicCollections();
  const changelogQuery = useLiveQuery({
    query: (q) =>
      q
        .from({ changelog: publicChangelogDetailCollection })
        .where(({ changelog }) =>
          and(
            eq(changelog.organizationId, site.organizationId),
            eq(changelog.slug, changelogSlug)
          )
        )
        .findOne(),
  });
  // Resolved before the dependent query below: its callback runs during the
  // hook call, so `changelog` has to be initialized by then.
  const changelog = changelogQuery.data;
  const isError = changelogQuery.isError;

  const { data: categoryLinks = [] } = useLiveQuery({
    query: (q) => {
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
  });
  const categoryIds = categoryLinks.map((link) => link.categoryId);

  // Linked posts ship inside the single-entry response (`ChangelogDetail`),
  // so the page never syncs every post, status, or changelog link in the
  // organization just to render this section.
  const linkedPosts = changelog?.posts ?? [];
  // Hydration lands the entry before the first client render (see
  // `isLiveQueryPending`).
  const isLoading = isLiveQueryPending(changelogQuery);

  if (isLoading) {
    return <ChangelogPageLayout>{m.quick_tidy_javelina()}</ChangelogPageLayout>;
  }

  if (isError) {
    return (
      <ChangelogPageLayout>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{m.cute_dull_panda()}</EmptyTitle>
            <EmptyDescription>{m.mealy_steep_squid()}</EmptyDescription>
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
            <EmptyTitle>{m.least_inclusive_kangaroo()}</EmptyTitle>
            <EmptyDescription>{m.grand_grassy_anteater()}</EmptyDescription>
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
            to="/s/changelog"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} />
            {m.polite_level_octopus()}
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
                {m.crazy_gross_emu({
                  name: changelog.user.name ?? m.even_giant_beaver(),
                })}
              </p>
            </div>
          </header>

          <MarkdownContent content={changelog.content} />

          <ChangelogSubscribeButton />

          {linkedPosts.length > 0 ? (
            <section
              aria-labelledby="linked-posts-heading"
              className="space-y-3"
            >
              <h2
                className="text-xl font-semibold tracking-tight"
                id="linked-posts-heading"
              >
                {m.away_blue_mink()}
              </h2>
              <div className="divide-y rounded-xl border">
                {linkedPosts.map((post) => (
                  <Link
                    className="hover:bg-muted/40 flex items-center justify-between gap-4 px-4 py-3 transition-colors"
                    key={post.id}
                    params={{ slug: post.slug }}
                    to="/s/p/$slug"
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
