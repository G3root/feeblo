import { eq, useLiveQuery } from "@tanstack/react-db";
import { Link } from "wouter";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
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
    return (
      <FeedbackBrowseLayout>
        <FeedbackBrowseLayoutContent fullWidth>
          <FeedbackBrowseLayoutMain>
            Loading changelog...
          </FeedbackBrowseLayoutMain>
        </FeedbackBrowseLayoutContent>
      </FeedbackBrowseLayout>
    );
  }

  if (isError) {
    return (
      <FeedbackBrowseLayout>
        <FeedbackBrowseLayoutContent fullWidth>
          <FeedbackBrowseLayoutMain>
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>Changelog unavailable</EmptyTitle>
                <EmptyDescription>
                  There was a problem loading published changelog entries.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </FeedbackBrowseLayoutMain>
        </FeedbackBrowseLayoutContent>
      </FeedbackBrowseLayout>
    );
  }

  return (
    <FeedbackBrowseLayout>
      <FeedbackBrowseLayoutContent fullWidth>
        <FeedbackBrowseLayoutMain>
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
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {changelogs.map((item) => (
                <Card className="ring-1 ring-border/60" key={item.id}>
                  <CardHeader className="space-y-3">
                    <Badge variant="outline">
                      {formatDate(item.publishedAt ?? item.createdAt)}
                    </Badge>
                    <CardTitle>{item.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-muted-foreground text-sm leading-6">
                      {getChangelogExcerpt(item.content)}
                    </p>
                    <Link
                      className={cn(
                        buttonVariants({ size: "sm", variant: "outline" }),
                        "w-fit"
                      )}
                      href={`/changelog/${item.slug}`}
                    >
                      Read update
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </FeedbackBrowseLayoutMain>
      </FeedbackBrowseLayoutContent>
    </FeedbackBrowseLayout>
  );
}

function getChangelogExcerpt(content: string) {
  const textOnly = content
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return textOnly || "Published changelog update.";
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}
