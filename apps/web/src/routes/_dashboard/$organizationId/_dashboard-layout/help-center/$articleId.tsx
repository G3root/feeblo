import { isFeatureEnabled } from "@feeblo/domain/feature-flags";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { useFeatureFlag } from "@feeblo/web-shared/use-feature-flag";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { HelpCenterArticleEditor } from "~/features/help-center/components/help-center-article-editor";
import { HelpCenterUnavailable } from "~/features/help-center/components/help-center-unavailable";
import { preloadHelpCenterEditor } from "~/lib/preloads";
import { fetchRpc } from "~/lib/runtime";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/help-center/$articleId"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    if (isFeatureEnabled("HELP_CENTER")) {
      await preloadHelpCenterEditor();
    }

    return null;
  },
});

/**
 * The editor reads one article by id rather than from the list collection.
 *
 * The list's rows are summaries — a body in every row would make a page of
 * fifty articles a multi-megabyte payload — so the body is fetched here, once,
 * for the one article being edited. The topics still come from the collection,
 * because the editor needs the whole list to move an article between them.
 */
function RouteComponent() {
  const { organizationId, articleId } = Route.useParams();
  const enabled = useFeatureFlag("HELP_CENTER");

  const articleQuery = useQuery({
    // Disabled while the feature is off, so a deep link does not fire a request
    // the server would refuse anyway.
    enabled,
    queryKey: ["help-center-article", organizationId, articleId],
    queryFn: () =>
      fetchRpc((rpc) =>
        rpc.GetHelpCenterArticle({ organizationId, id: articleId })
      ),
  });

  if (!enabled) {
    return <HelpCenterUnavailable />;
  }

  if (articleQuery.isError) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Article unavailable</EmptyTitle>
          <EmptyDescription>
            {articleQuery.error instanceof Error
              ? articleQuery.error.message
              : "There was a problem loading this article."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const article = articleQuery.data;

  if (article === undefined) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Loading…</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <HelpCenterArticleEditor
      key={article.id}
      article={{
        content: article.content,
        id: article.id,
        position: article.position,
        publishedAt: article.publishedAt,
        slug: article.slug,
        status: article.status,
        title: article.title,
        topicId: article.topicId,
      }}
      organizationId={organizationId}
    />
  );
}
