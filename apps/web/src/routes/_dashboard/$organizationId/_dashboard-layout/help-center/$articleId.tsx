import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { HelpCenterArticleEditor } from "~/features/help-center/components/help-center-article-editor";
import { preloadHelpCenterEditor } from "~/lib/preloads";
import { fetchRpc } from "~/lib/runtime";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/help-center/$articleId"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await preloadHelpCenterEditor();

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

  const articleQuery = useQuery({
    queryKey: ["help-center-article", organizationId, articleId],
    queryFn: () =>
      fetchRpc((rpc) =>
        rpc.GetHelpCenterArticle({ organizationId, id: articleId })
      ),
  });

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
