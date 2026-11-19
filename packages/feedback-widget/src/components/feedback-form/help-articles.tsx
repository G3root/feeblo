import { For, Show } from "solid-js";

import { Spinner } from "../ui/spinner";
import { useFeedbackForm } from "./context";

/**
 * The help-center half of the composer's deflection: documentation that may
 * already answer the question, shown above the similar-posts panel.
 *
 * Each link opens the portal in a new tab. The widget is an iframe on the
 * customer's own page, so navigating the iframe would strand the embedding page
 * on a portal route; `noreferrer` also keeps the portal from learning which
 * customer page the visitor came from.
 */
export function FeedbackFormHelpArticles() {
  const { state } = useFeedbackForm();

  return (
    // The latch is part of the visibility: once the workspace has no help
    // center, a stale payload must not resurrect the panel for this session.
    <Show when={state.helpArticlesEnabled() && state.helpArticles().length > 0}>
      <section
        aria-busy={state.helpArticlesPending()}
        aria-label="Related documentation"
        class="widget-enter bg-muted/40 overflow-hidden rounded-xl border"
        data-enter="fade"
      >
        <div class="flex items-start justify-between gap-2 border-b px-3.5 py-2.5">
          <div>
            <p class="text-sm font-medium">Related documentation</p>
            <p class="text-muted-foreground text-xs">
              This may already be answered in the help center.
            </p>
          </div>
          <Show when={state.helpArticlesPending()}>
            <Spinner class="text-muted-foreground mt-0.5 size-3.5" />
          </Show>
        </div>
        <ul>
          <For each={state.helpArticles()}>
            {(article) => (
              <li class="border-b last:border-b-0">
                <a
                  class="flex flex-col gap-0.5 px-3.5 py-2.5"
                  href={article.url}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  <span class="text-sm font-medium">{article.title}</span>
                  <Show when={article.excerpt}>
                    <span class="text-muted-foreground line-clamp-1 text-xs">
                      {article.excerpt}
                    </span>
                  </Show>
                </a>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}
