import { useAtomValue } from "@effect/atom-react";
import { isFeatureEnabled } from "@feeblo/domain/feature-flags";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { Skeleton } from "@feeblo/ui/skeleton";
import { useFeatureFlag } from "@feeblo/web-shared/use-feature-flag";
import { createFileRoute } from "@tanstack/react-router";
import * as Result from "effect/reactivity/AsyncResult";
import { useMemo } from "react";

import {
  helpCenterArticleAtom,
  type HelpCenterArticleAtomArgs,
} from "~/features/help-center/atoms";
import { HelpCenterArticleEditor } from "~/features/help-center/components/help-center-article-editor";
import { HelpCenterUnavailable } from "~/features/help-center/components/help-center-unavailable";
import { preloadHelpCenterEditor } from "~/lib/preloads";

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
 * The editor reads one article by id, through an atom rather than a query.
 *
 * The list's rows are summaries — a body in every row would make a page of
 * fifty articles a multi-megabyte payload — so the body is fetched here, once,
 * for the one article being edited. The topics still come from the collection,
 * because the editor needs the whole list to move an article between them.
 *
 * `args` is memoized because `Atom.family` keys on identity: a fresh literal per
 * render would be a fresh atom per render.
 */
function RouteComponent() {
  const { organizationId, articleId } = Route.useParams();
  const enabled = useFeatureFlag("HELP_CENTER");

  const args = useMemo<HelpCenterArticleAtomArgs>(
    () => ({ id: articleId, organizationId }),
    [articleId, organizationId]
  );

  const articleResult = useAtomValue(helpCenterArticleAtom(args));

  if (!enabled) {
    return <HelpCenterUnavailable />;
  }

  return Result.builder(articleResult)
    .onInitial(() => (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <Skeleton className="h-9 w-1/3" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    ))
    .onFailure((error) => (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Article unavailable</EmptyTitle>
          <EmptyDescription>
            {error instanceof Error
              ? error.message
              : "There was a problem loading this article."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    ))
    .onSuccess((article) => (
      <HelpCenterArticleEditor
        // Keyed by the row, so a different article is a different editor: the
        // form and the status it opened on both belong to one article.
        key={article.id}
        mode="edit"
        article={article}
        organizationId={organizationId}
      />
    ))
    .exhaustive();
}
