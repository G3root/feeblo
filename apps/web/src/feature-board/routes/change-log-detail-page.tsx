import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { cn } from "~/lib/utils";
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

export function ChangeLogDetailPage({
  changelogSlug,
}: {
  changelogSlug: string;
}) {
  const site = useSite();
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
    return <MainLayout>Loading changelog...</MainLayout>;
  }

  if (isError) {
    return (
      <MainLayout>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Changelog unavailable</EmptyTitle>
            <EmptyDescription>
              There was a problem loading this published changelog.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </MainLayout>
    );
  }

  if (!changelog) {
    return (
      <MainLayout>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Changelog not found</EmptyTitle>
            <EmptyDescription>
              This published changelog entry does not exist anymore.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <article className="space-y-8">
        <Link
          className={cn(
            buttonVariants({ size: "sm", variant: "ghost" }),
            "w-fit"
          )}
          href="/changelog"
        >
          <ArrowLeft />
          Back
        </Link>

        <header className="space-y-4">
          <Badge variant="outline">
            {formatDate(changelog.publishedAt ?? changelog.createdAt)}
          </Badge>
          <div className="space-y-3">
            <h1 className="max-w-3xl font-semibold text-4xl tracking-tight">
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
      </article>
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
