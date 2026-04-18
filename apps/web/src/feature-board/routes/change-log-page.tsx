import { eq, useLiveQuery } from "@tanstack/react-db";
import type { ReactNode } from "react";
import { Link } from "wouter";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { Separator } from "~/components/ui/separator";
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
        <>
          <div className="pt-6 pb-8">
            <Separator />
          </div>

          <div className="relative">
            <div
              aria-hidden="true"
              className="absolute top-0 left-3 hidden h-full w-px bg-border/60 md:block"
            />
            {changelogs.map((item) => (
              <article
                className="grid gap-6 pb-14 md:grid-cols-[11rem_minmax(0,1fr)] md:items-start md:gap-10 md:pb-16"
                key={item.id}
              >
                <div className="relative md:self-start">
                  <div className="relative flex items-center gap-3 md:sticky md:top-24 md:pl-8">
                    <span
                      aria-hidden="true"
                      className="absolute top-1/2 left-3 hidden size-2.5 -translate-x-1/2 -translate-y-1/2 md:block"
                    >
                      <span className="absolute inset-0 size-2.5 animate-ping rounded-full bg-foreground/35" />
                      <span className="relative block size-2.5 rounded-full bg-foreground" />
                    </span>
                    <time className="font-medium text-muted-foreground text-sm tracking-tight">
                      {formatDate(item.publishedAt ?? item.createdAt)}
                    </time>
                  </div>
                </div>

                <div className="min-w-0 space-y-6 p-0 sm:p-0">
                  <header>
                    <Link
                      className="block w-fit transition-opacity hover:opacity-80"
                      href={`/changelog/${item.slug}`}
                    >
                      <h3 className="font-semibold text-2xl tracking-tight sm:text-3xl">
                        {item.title}
                      </h3>
                    </Link>
                  </header>

                  <div
                    className="typography"
                    dangerouslySetInnerHTML={{ __html: item.content }}
                  />
                </div>
              </article>
            ))}
          </div>
        </>
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
