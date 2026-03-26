import { eq, useLiveQuery } from "@tanstack/react-db";
import { Link } from "wouter";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { cn } from "~/lib/utils";
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
      <div className="mx-auto max-w-5xl px-4 py-8 text-muted-foreground text-sm sm:px-6 lg:px-8">
        Loading changelog...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-border/60 p-10 text-center">
          <p className="font-medium text-sm">Changelog unavailable</p>
          <p className="mt-1 text-muted-foreground text-sm">
            There was a problem loading published changelog entries.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="space-y-3">
        <Badge variant="outline">Published updates</Badge>
        <h1 className="font-semibold text-3xl tracking-tight">Changelog</h1>
        <p className="max-w-2xl text-muted-foreground text-sm leading-6">
          Track product updates, launches, and shipped improvements.
        </p>
      </div>

      {changelogs.length === 0 ? (
        <div className="mt-8 rounded-lg border border-border/70 border-dashed p-12 text-center">
          <p className="font-medium text-foreground/80 text-sm">
            No published changelogs yet
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            Published updates will appear here once they are released.
          </p>
        </div>
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
    </div>
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
