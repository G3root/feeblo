import { createAsync, useParams } from "@solidjs/router";
import { Show, Suspense } from "solid-js";

import {
  HelpArticle,
  HelpArticleNotFound,
} from "../components/help/help-article";
import { HelpListSkeleton } from "../components/help/help-list-skeleton";
import { ViewTransition } from "../components/shell/view-transition";
import { fetchHelpCenter, fetchHelpCenterArticle } from "../lib/api";

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
  const helpCenter = createAsync(() => fetchHelpCenter());

  const article = createAsync(() =>
    fetchHelpCenterArticle(params.articleSlug ?? "")
  );

  return (
    <Show
      fallback={
        <Show
          fallback={<HelpArticleNotFound />}
          when={helpCenter()?.enabled === true}
        >
          <HelpArticleNotFound />
        </Show>
      }
      keyed
      when={article()}
    >
      {(loaded) => <HelpArticle article={loaded} />}
    </Show>
  );
}
