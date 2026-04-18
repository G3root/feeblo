import { eq, useLiveQuery } from "@tanstack/react-db";
import type { ReactNode } from "react";
import { Link } from "wouter";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "~/components/ui/item";
import {
  FeedbackBrowseLayout,
  FeedbackBrowseLayoutContent,
  FeedbackBrowseLayoutMain,
} from "../components/layout/feedback-browse-layout";
import { publicChangelogCollection } from "../lib/collections";
import { useSite } from "../providers/site-provider";

function MainLayout({ children }: { children: ReactNode }) {
  return (
    <FeedbackBrowseLayout>
      <FeedbackBrowseLayoutContent fullWidth>
        <FeedbackBrowseLayoutMain>{children}</FeedbackBrowseLayoutMain>
      </FeedbackBrowseLayoutContent>
    </FeedbackBrowseLayout>
  );
}

export function ChangelogPage() {
  const site = useSite();
  const {
    data: changelogs = [],
    isLoading,
    isError,
  } = useLiveQuery(
    (q) =>
      q
        .from({ changelog: publicChangelogCollection })
        .where(({ changelog }) =>
          eq(changelog.organizationId, site.organizationId)
        )
        .orderBy(({ changelog }) => changelog.publishedAt, "desc"),
    [site.organizationId]
  );

  if (isLoading) {
    return <MainLayout>Loading changelog...</MainLayout>;
  }

  if (isError) {
    return (
      <MainLayout>
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Changelog unavailable</EmptyTitle>
            <EmptyDescription>
              There was a problem loading published changelog entries.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <h2 className="pb-3 font-semibold text-base tracking-tight">
        Changelogs
      </h2>
      {changelogs.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No published changelogs yet</EmptyTitle>
            <EmptyDescription>
              Published changelog updates will appear here once they are
              released.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup className="gap-2">
          {changelogs.map((item) => (
            <Item
              key={item.id}
              render={
                <Link href={`/changelog/${item.slug}`}>
                  <ItemContent>
                    <ItemTitle>{item.title}</ItemTitle>
                    <ItemDescription>
                      Published {formatDate(item.publishedAt ?? item.createdAt)}
                    </ItemDescription>
                  </ItemContent>
                </Link>
              }
              role="listitem"
              variant="muted"
            />
          ))}
        </ItemGroup>
      )}
    </MainLayout>
  );
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}
