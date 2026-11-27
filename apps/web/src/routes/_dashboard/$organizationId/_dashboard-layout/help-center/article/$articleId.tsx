import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { Skeleton } from "@feeblo/ui/skeleton";
import { parseRpcError } from "@feeblo/web-shared/rpc-error";
import { createFileRoute } from "@tanstack/react-router";
import * as Result from "effect/reactivity/AsyncResult";
import { useMemo } from "react";

import { m } from "@/paraglide/messages.js";
import { EditorLayout } from "~/components/editor-layout";
import {
  helpCenterArticleAtom,
  type HelpCenterArticleAtomArgs,
} from "~/features/help-center/atoms";
import { HelpCenterArticleEditor } from "~/features/help-center/components/help-center-article-editor";
import { preloadHelpCenterEditor } from "~/lib/preloads";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/help-center/article/$articleId"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await preloadHelpCenterEditor();

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

  const args = useMemo<HelpCenterArticleAtomArgs>(
    () => ({ id: articleId, organizationId }),
    [articleId, organizationId]
  );

  const atom = helpCenterArticleAtom(args);
  const articleResult = useAtomValue(atom);
  const refresh = useAtomRefresh(atom);

  return Result.builder(articleResult)
    .onInitial(() => (
      <EditorLayout>
        <EditorLayout.Main>
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-96 w-full" />
        </EditorLayout.Main>
        <EditorLayout.Sidebar>
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-24 w-full" />
        </EditorLayout.Sidebar>
      </EditorLayout>
    ))
    .onFailure((error) => (
      <EditorLayout>
        <EditorLayout.Main>
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Article unavailable</EmptyTitle>
              {/* The atom carries the RPC's own failure, which is a decoded
                  tagged object rather than an `Error`; `instanceof` would take
                  the fallback for every real one. */}
              <EmptyDescription>
                {parseRpcError(error).message}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={refresh} type="button" variant="outline">
                {m.even_seemly_bear()}
              </Button>
            </EmptyContent>
          </Empty>
        </EditorLayout.Main>
      </EditorLayout>
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
