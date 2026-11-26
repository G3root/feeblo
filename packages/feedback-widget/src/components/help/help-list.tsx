import { createAsync } from "@solidjs/router";
import { For, Show, Suspense } from "solid-js";

import { fetchHelpCenter, type WidgetHelpCenter } from "../../lib/api";
import { consumeSurfaceEntry } from "../../lib/motion";
import { ViewTransition } from "../shell/view-transition";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { HelpListSkeleton } from "./help-list-skeleton";

/**
 * The help module's root: the workspace's published documentation, grouped by
 * section in the order the server sent it.
 *
 * The grouping happens here rather than in the payload because the article list
 * is already ordered by section: a second read that returned section names
 * would only restate what these rows carry.
 */
export function HelpList() {
  return (
    <ViewTransition kind="root">
      <Suspense fallback={<HelpListSkeleton />}>
        <HelpListScreen />
      </Suspense>
    </ViewTransition>
  );
}

type HelpSection = {
  readonly articles: WidgetHelpCenter["articles"];
  readonly name: string;
  readonly topicId: string;
};

/**
 * The rows grouped into sections, in the order they arrived.
 *
 * `findManyPublic` already orders by the section's position, so the sections are
 * the distinct topic ids in first-seen order and each one's articles are the
 * rows that share it. No accumulator and no grouping by hand: this is a
 * projection of an order the server already decided.
 */
function groupBySection(
  articles: WidgetHelpCenter["articles"]
): readonly HelpSection[] {
  const topicIds = [...new Set(articles.map((article) => article.topicId))];

  return topicIds.map((topicId) => ({
    articles: articles.filter((article) => article.topicId === topicId),
    name:
      articles.find((article) => article.topicId === topicId)?.topicName ?? "",
    topicId,
  }));
}

function HelpListScreen() {
  const helpCenter = createAsync(() => fetchHelpCenter());
  const staggerRows = consumeSurfaceEntry("help");

  return (
    <Show keyed when={helpCenter()}>
      {(data) => (
        <div class="p-6">
          <header>
            <h1 class="text-foreground text-lg font-medium">Help center</h1>
            <p class="text-muted-foreground mt-1 text-sm">
              Guides and answers from the team.
            </p>
          </header>

          <Show
            fallback={
              <Empty class="widget-enter mt-6 border" data-enter="fade">
                <EmptyHeader>
                  <EmptyTitle>No documentation yet</EmptyTitle>
                  <EmptyDescription>
                    Published help articles will appear here.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            }
            when={data.articles.length > 0}
          >
            <div class="mt-6 flex flex-col gap-6">
              <For each={groupBySection(data.articles)}>
                {(section) => (
                  <section aria-labelledby={`help-section-${section.topicId}`}>
                    <h2
                      class="text-muted-foreground text-xs font-medium tracking-wide uppercase"
                      id={`help-section-${section.topicId}`}
                    >
                      {section.name}
                    </h2>
                    <ul class="mt-2 flex flex-col gap-2">
                      <For each={section.articles}>
                        {(article, index) => (
                          <li
                            class={staggerRows ? "widget-stagger" : undefined}
                            style={
                              staggerRows
                                ? { "--stagger-index": String(index()) }
                                : undefined
                            }
                          >
                            <a
                              class="hover:bg-muted/60 block rounded-lg border p-3 transition-colors"
                              href={`#/help/${encodeURIComponent(article.slug)}`}
                            >
                              <span class="flex items-center gap-2">
                                <span class="text-foreground text-sm font-medium">
                                  {article.title}
                                </span>
                                <Show when={article.isArchived}>
                                  <span class="text-muted-foreground shrink-0 text-[11px]">
                                    Out of date
                                  </span>
                                </Show>
                              </span>
                              <Show when={article.excerpt.length > 0}>
                                <span class="text-muted-foreground mt-1 line-clamp-2 block text-xs">
                                  {article.excerpt}
                                </span>
                              </Show>
                            </a>
                          </li>
                        )}
                      </For>
                    </ul>
                  </section>
                )}
              </For>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}
