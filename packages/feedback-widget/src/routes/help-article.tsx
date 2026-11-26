import { createAsync, useParams } from "@solidjs/router";
import { Show, Suspense } from "solid-js";

import {
  HelpArticle,
  HelpArticleNotFound,
} from "../components/help/help-article";
import { HelpListSkeleton } from "../components/help/help-list-skeleton";
import { ViewTransition } from "../components/shell/view-transition";
import { fetchHelpCenterArticle } from "../lib/api";

export default function HelpArticleRoute() {
  return (
    <ViewTransition kind="push">
      <Suspense fallback={<HelpListSkeleton />}>
        <HelpArticleScreen />
      </Suspense>
    </ViewTransition>
  );
}

function HelpArticleScreen() {
  const params = useParams();

  const article = createAsync(() =>
    fetchHelpCenterArticle(params.articleSlug ?? "")
  );

  // One "not found" for a slug that is unpublished and for one that never
  // existed: the endpoint cannot distinguish them, and neither should the page.
  // A workspace with no documentation never reaches this route — the shell moves
  // it to a surface that exists.
  return (
    <Show fallback={<HelpArticleNotFound />} keyed when={article()}>
      {(loaded) => <HelpArticle article={loaded} />}
    </Show>
  );
}
