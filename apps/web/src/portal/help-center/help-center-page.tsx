import { isFeatureEnabled } from "@feeblo/domain/feature-flags";
import { useSite } from "@feeblo/public-feature-board/providers/site-provider";
import { Badge } from "@feeblo/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { Skeleton } from "@feeblo/ui/skeleton";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

/**
 * The portal's help center index.
 *
 * Read through the public RPCs rather than the dashboard's collections, and
 * deliberately so: the portal sees published articles and nothing else, and a
 * projection that shared the dashboard's list would have to filter drafts out
 * on the client — one forgotten filter away from leaking unreleased
 * documentation.
 */
export function HelpCenterPage() {
  const site = useSite();
  const organizationId = site.organizationId;
  const enabled = isFeatureEnabled("HELP_CENTER");

  const topicsQuery = useQuery({
    enabled,
    queryKey: ["portal-help-center-topics", organizationId],
    queryFn: () =>
      fetchRpc((rpc) => rpc.ListHelpCenterTopicsPublic({ organizationId })),
  });

  const articlesQuery = useQuery({
    enabled,
    queryKey: ["portal-help-center-articles", organizationId],
    queryFn: () =>
      fetchRpc((rpc) => rpc.ListHelpCenterArticlesPublic({ organizationId })),
  });

  if (!enabled) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>Not found</EmptyTitle>
          <EmptyDescription>This page is not available.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (topicsQuery.isPending || articlesQuery.isPending) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 py-8">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const topics = topicsQuery.data ?? [];
  const articles = articlesQuery.data ?? [];

  if (topics.length === 0) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>No documentation yet</EmptyTitle>
          <EmptyDescription>
            Nothing has been published to the help center.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Help center</h1>
        <p className="text-muted-foreground text-sm">
          Guides and answers for {site.name}.
        </p>
      </header>

      <div className="mt-8 space-y-6">
        {topics.map((topic) => {
          const topicArticles = articles.filter(
            (article) => article.topicId === topic.id
          );

          return (
            <section key={topic.id} className="rounded-lg border">
              <header className="border-b px-4 py-3">
                <h2 className="text-sm font-semibold">{topic.name}</h2>
                {topic.description === null ? null : (
                  <p className="text-muted-foreground text-xs">
                    {topic.description}
                  </p>
                )}
              </header>
              <ul className="divide-y">
                {topicArticles.map((article) => (
                  <li key={article.id}>
                    <Link
                      className="hover:bg-muted/50 flex items-start gap-3 px-4 py-3 transition-colors"
                      to="/s/help/articles/$articleSlug"
                      params={{ articleSlug: article.slug }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {article.title}
                          </span>
                          {article.isArchived ? (
                            <Badge variant="outline">Out of date</Badge>
                          ) : null}
                        </div>
                        {article.excerpt.length === 0 ? null : (
                          <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                            {article.excerpt}
                          </p>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
