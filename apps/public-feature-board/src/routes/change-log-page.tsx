import { DebouncedInputGroupInput } from "@feeblo/ui/debounced-input";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
} from "@feeblo/ui/input-group";
import { MarkdownContent } from "@feeblo/ui/markdown-content";
import { Separator } from "@feeblo/ui/separator";
import { RssIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, ilike, useLiveQuery } from "@tanstack/react-db";
import { createLazyRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChangelogCategoryBadges } from "../components/changelog/changelog-category-badge";
import {
  ChangelogPageLayout,
  ChangelogTimeline,
  ChangelogTimelineBody,
  ChangelogTimelineDate,
  ChangelogTimelineItem,
  formatChangelogDate,
} from "../components/changelog/changelog-layout";
import { usePublicCollections } from "../providers/public-collections-provider";
import { useSite } from "../providers/site-provider";

export const Route = createLazyRoute("/changelog")({
  component: ChangelogPage,
});

export function ChangelogPage() {
  const site = useSite();
  const { publicChangelogCategoryLinkCollection, publicChangelogCollection } =
    usePublicCollections();
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim();
  const {
    data: changelogs = [],
    isLoading,
    isError,
  } = useLiveQuery(
    (q) =>
      q
        .from({ changelog: publicChangelogCollection })
        .where(({ changelog }) => {
          let condition = eq(changelog.organizationId, site.organizationId);

          if (normalizedSearch) {
            condition = and(
              condition,
              ilike(changelog.title, `%${normalizedSearch}%`)
            );
          }

          return condition;
        })
        .orderBy(({ changelog }) => changelog.publishedAt, "desc"),
    [site.organizationId, normalizedSearch]
  );

  const { data: categoryLinks = [] } = useLiveQuery(
    (q) =>
      q
        .from({ link: publicChangelogCategoryLinkCollection })
        .where(({ link }) => eq(link.organizationId, site.organizationId)),
    [site.organizationId]
  );
  const categoryIdsByChangelog = new Map<string, string[]>();
  for (const link of categoryLinks) {
    const ids = categoryIdsByChangelog.get(link.changelogId) ?? [];
    ids.push(link.categoryId);
    categoryIdsByChangelog.set(link.changelogId, ids);
  }

  if (isLoading) {
    return <ChangelogPageLayout>Loading changelog...</ChangelogPageLayout>;
  }

  if (isError) {
    return (
      <ChangelogPageLayout>
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Changelog unavailable</EmptyTitle>
            <EmptyDescription>
              There was a problem loading published changelog entries.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ChangelogPageLayout>
    );
  }

  return (
    <ChangelogPageLayout>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-base tracking-tight">Changelogs</h2>
          <a
            aria-label="Subscribe to the changelog RSS feed"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            href="/changelog/rss.xml"
            title="RSS feed"
          >
            <HugeiconsIcon icon={RssIcon} />
          </a>
        </div>
        <div className="w-full sm:w-72">
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>
                <HugeiconsIcon icon={Search01Icon} />
              </InputGroupText>
            </InputGroupAddon>
            <DebouncedInputGroupInput
              aria-label="Search changelog titles"
              onChange={setSearch}
              placeholder="Search changelog titles"
              value={search}
            />
          </InputGroup>
        </div>
      </div>
      {changelogs.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {normalizedSearch
                ? "No changelogs match your search"
                : "No published changelogs yet"}
            </EmptyTitle>
            <EmptyDescription>
              {normalizedSearch
                ? "Try a different title search."
                : "Published changelog updates will appear here once they are released."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="pt-6 pb-8">
            <Separator />
          </div>

          <ChangelogTimeline>
            {changelogs.map((item) => (
              <ChangelogTimelineItem className="pb-14 md:pb-16" key={item.id}>
                <ChangelogTimelineDate>
                  <time className="font-medium text-muted-foreground text-sm tracking-tight">
                    {formatChangelogDate(item.publishedAt ?? item.createdAt)}
                  </time>
                </ChangelogTimelineDate>

                <ChangelogTimelineBody className="space-y-6 p-0 sm:p-0">
                  {item.coverImage ? (
                    <img
                      alt=""
                      className="aspect-[16/7] w-full rounded-xl border object-cover"
                      height={525}
                      src={item.coverImage}
                      width={1200}
                    />
                  ) : null}
                  <header className="space-y-3">
                    <ChangelogCategoryBadges
                      categoryIds={categoryIdsByChangelog.get(item.id) ?? []}
                    />
                    <Link
                      className="block w-fit transition-opacity hover:opacity-80"
                      params={{ changelogSlug: item.slug }}
                      to="/changelog/$changelogSlug"
                    >
                      <h3 className="font-semibold text-2xl tracking-tight sm:text-3xl">
                        {item.title}
                      </h3>
                    </Link>
                  </header>

                  <MarkdownContent content={item.content} />
                </ChangelogTimelineBody>
              </ChangelogTimelineItem>
            ))}
          </ChangelogTimeline>
        </>
      )}
    </ChangelogPageLayout>
  );
}
