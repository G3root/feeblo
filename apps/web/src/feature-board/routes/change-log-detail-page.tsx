import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { publicChangelogCollection } from "../lib/collections";
import { useSite } from "../providers/site-provider";

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
            There was a problem loading this published changelog.
          </p>
        </div>
      </div>
    );
  }

  if (!changelog) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-border/60 p-10 text-center">
          <p className="font-medium text-sm">Changelog not found</p>
          <p className="mt-1 text-muted-foreground text-sm">
            This published changelog entry does not exist anymore.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
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
          className="prose prose-sm max-w-none prose-img:rounded-lg prose-img:border prose-a:text-foreground prose-headings:text-foreground text-foreground/85 prose-p:leading-7"
          dangerouslySetInnerHTML={{ __html: changelog.content }}
        />
      </article>
    </div>
  );
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}
