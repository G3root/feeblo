import { createFileRoute } from "@tanstack/react-router";

import { HelpCenterArticlePage } from "@/portal/help-center/help-center-article-page";

export const Route = createFileRoute("/s/help/articles/$articleSlug")({
  component: RouteComponent,
});

function RouteComponent() {
  const { articleSlug } = Route.useParams();

  return <HelpCenterArticlePage articleSlug={articleSlug} />;
}
