import { Button } from "@feeblo/ui/button";
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
import { ScrollArea } from "@feeblo/ui/scroll-area";
import { Separator } from "@feeblo/ui/separator";
import {
  Cancel01Icon,
  RssIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, ilike, inArray, useLiveQuery } from "@tanstack/react-db";
import { createLazyRoute, Link } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";
import { useMemo } from "react";

import { ChangelogCategoryBadges } from "../components/changelog/changelog-category-badge";
import { ChangelogCategoryFilter } from "../components/changelog/changelog-category-filter";
import {
  ChangelogPageLayout,
  ChangelogTimeline,
  ChangelogTimelineBody,
  ChangelogTimelineDate,
  ChangelogTimelineItem,
  formatChangelogDate,
} from "../components/changelog/changelog-layout";
import {
  ChangelogFilterProvider,
  useChangelogFilterStore,
} from "../lib/changelog-filter-store";
import { usePublicCollections } from "../providers/public-collections-provider";
import { useSite } from "../providers/site-provider";

export const Route = createLazyRoute("/changelog")({
  component: () => (
    <ChangelogFilterProvider>
      <ChangelogPage />
    </ChangelogFilterProvider>
  ),
});

export function ChangelogPage() {
  const site = useSite();
  const { publicChangelogCategoryLinkCollection, publicChangelogCollection } =
    usePublicCollections();
  const store = useChangelogFilterStore();
  const search = useSelector(store, (state) => state.context.search);
  const selectedCategoryIds = useSelector(
    store,
    (state) => state.context.selectedCategoryIds
  );
  const normalizedSearch = search.trim();
  const hasActiveCategoryFilter = selectedCategoryIds.length > 0;

  const { data: matchingLinks = [] } = useLiveQuery(
    (q) =>
      q
        .from({ link: publicChangelogCategoryLinkCollection })
        .where(({ link }) =>
          and(
            eq(link.organizationId, site.organizationId),
            inArray(link.categoryId, selectedCategoryIds)
          )
        )
        .select(({ link }) => ({ changelogId: link.changelogId })),
    [site.organizationId, ...selectedCategoryIds]
  );

  const uniqueChangelogIds = useMemo(
    () => [...new Set(matchingLinks.map((l) => l.changelogId))],
    [matchingLinks]
  );

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

          if (hasActiveCategoryFilter && uniqueChangelogIds.length > 0) {
            condition = and(
              condition,
              inArray(changelog.id, uniqueChangelogIds)
            );
          }

          return condition;
        })
        .orderBy(({ changelog }) => changelog.publishedAt, "desc"),
    [
      site.organizationId,
      normalizedSearch,
      hasActiveCategoryFilter,
      uniqueChangelogIds,
    ]
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
          <h2 className="text-base font-semibold tracking-tight">Changelogs</h2>
          <a
            aria-label="Subscribe to the changelog RSS feed"
            className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1.5 transition-colors"
            href="/changelog/rss.xml"
            title="RSS feed"
          >
            <HugeiconsIcon icon={RssIcon} />
          </a>
        </div>
        <ChangelogFilterToolbar
          hasActiveCategoryFilter={hasActiveCategoryFilter}
        />
      </div>
      {changelogs.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {normalizedSearch || hasActiveCategoryFilter
                ? "No changelogs match your filters"
                : "No published changelogs yet"}
            </EmptyTitle>
            <EmptyDescription>
              {normalizedSearch || hasActiveCategoryFilter
                ? "Try a different search or category filter."
                : "Published changelog updates will appear here once they are released."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="pt-6 pb-8">
            <Separator />
          </div>

          <ScrollArea className="h-[calc(100vh-12rem)]">
            <ChangelogTimeline>
              {changelogs.map((item) => (
                <ChangelogTimelineItem className="pb-14 md:pb-16" key={item.id}>
                  <ChangelogTimelineDate>
                    <time className="text-muted-foreground text-sm font-medium tracking-tight">
                      {formatChangelogDate(item.publishedAt ?? item.createdAt)}
                    </time>
                  </ChangelogTimelineDate>

                  <ChangelogTimelineBody className="space-y-6 p-0 sm:p-0">
                    {item.coverImage ? (
                      <img
                        alt=""
                        className="aspect-[16/7] w-full rounded-xl border object-cover"
                        height={525}
                        loading="lazy"
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
                        <h3 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                          {item.title}
                        </h3>
                      </Link>
                    </header>

                    <MarkdownContent content={item.content} />
                  </ChangelogTimelineBody>
                </ChangelogTimelineItem>
              ))}
            </ChangelogTimeline>
          </ScrollArea>
        </>
      )}
    </ChangelogPageLayout>
  );
}

function ChangelogFilterToolbar({
  hasActiveCategoryFilter,
}: {
  hasActiveCategoryFilter: boolean;
}) {
  const store = useChangelogFilterStore();
  const search = useSelector(store, (state) => state.context.search);

  return (
    <div className="flex items-center gap-2">
      <ChangelogCategoryFilter />
      {hasActiveCategoryFilter ? (
        <Button
          onClick={() => {
            store.send({ type: "clearCategories" });
          }}
          size="icon-sm"
          variant="ghost"
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
        </Button>
      ) : null}
      <div className="w-full sm:w-72">
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText>
              <HugeiconsIcon icon={Search01Icon} />
            </InputGroupText>
          </InputGroupAddon>
          <DebouncedInputGroupInput
            aria-label="Search changelog titles"
            onChange={(value) => {
              store.send({ type: "setSearch", value });
            }}
            placeholder="Search changelog titles"
            value={search}
          />
        </InputGroup>
      </div>
    </div>
  );
}
