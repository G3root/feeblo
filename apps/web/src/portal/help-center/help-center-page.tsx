import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { isFeatureEnabled } from "@feeblo/domain/feature-flags";
import type { THelpCenterArticleSearchResult } from "@feeblo/domain/help-center-article/schema";
import { useSite } from "@feeblo/public-feature-board/providers/site-provider";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import { DebouncedInputGroupInput } from "@feeblo/ui/debounced-input";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { TablerIcon } from "@feeblo/ui/icon-picker";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
} from "@feeblo/ui/input-group";
import { Skeleton } from "@feeblo/ui/skeleton";
import { helpCenterTopicIconName } from "@feeblo/web-shared/icons/defaults";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import * as Result from "effect/reactivity/AsyncResult";
import { useMemo, useState } from "react";

import {
  helpCenterArticlesPublicAtom,
  helpCenterSearchPublicAtom,
  helpCenterTopicsPublicAtom,
  type HelpCenterSearchAtomArgs,
} from "./atoms";

/**
 * How short a query has to be before it is not a search.
 *
 * One character matches most of a help center, so asking the server for it
 * spends a round trip and a rate-limit token to return everything. The number
 * is shared with the widget's deflection for the same reason it exists: both
 * are the difference between "they are typing" and "they are looking for
 * something".
 */
const MIN_SEARCH_LENGTH = 2;

/**
 * The portal's help center index.
 *
 * Read through the public RPCs rather than the dashboard's collections, and
 * deliberately so: the portal sees published articles and nothing else, and a
 * projection that shared the dashboard's list would have to filter drafts out
 * on the client — one forgotten filter away from leaking unreleased
 * documentation.
 *
 * The search lives on this page rather than behind its own route because the
 * index is already the place a reader arrives at; a `/s/help/search?q=` URL
 * would be a second page whose only content is a shorter version of this one.
 * Results replace the topic list rather than filtering it: a topic whose
 * articles all rank low is not useful context beside the ranked answer.
 */
export function HelpCenterPage() {
  const site = useSite();
  const organizationId = site.organizationId;
  const enabled = isFeatureEnabled("HELP_CENTER");

  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();

  const topicsResult = useAtomValue(helpCenterTopicsPublicAtom(organizationId));

  const articlesResult = useAtomValue(
    helpCenterArticlesPublicAtom(organizationId)
  );

  const topics = Result.getOrElse(topicsResult, () => []);
  const articles = Result.getOrElse(articlesResult, () => []);

  const articlesByTopic = groupArticlesByTopic(articles);

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

  if (Result.isInitial(topicsResult) || Result.isInitial(articlesResult)) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 py-8">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
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

      <div className="mt-6">
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText>
              <HugeiconsIcon aria-hidden="true" icon={Search01Icon} />
            </InputGroupText>
          </InputGroupAddon>
          <DebouncedInputGroupInput
            aria-label="Search the help center"
            onChange={setQuery}
            placeholder="Search documentation"
            type="search"
            value={query}
            wait={250}
          />
        </InputGroup>
      </div>

      {trimmedQuery.length >= MIN_SEARCH_LENGTH ? (
        <HelpCenterSearchResults
          organizationId={organizationId}
          query={trimmedQuery}
        />
      ) : topics.length === 0 ? (
        <Empty className="py-16">
          <EmptyHeader>
            <EmptyTitle>No documentation yet</EmptyTitle>
            <EmptyDescription>
              Nothing has been published to the help center.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="mt-8 space-y-6">
          {topics.map((topic) => {
            const topicArticles = articlesByTopic.get(topic.id) ?? [];

            return (
              <section className="rounded-lg border" key={topic.id}>
                <header className="border-b px-4 py-3">
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <TablerIcon
                      className="text-muted-foreground size-4"
                      name={helpCenterTopicIconName(topic.icon)}
                    />
                    {topic.name}
                  </h2>
                  {topic.description === null ? null : (
                    <p className="text-muted-foreground text-xs">
                      {topic.description}
                    </p>
                  )}
                </header>
                <ul className="divide-y">
                  {topicArticles.map((article) => (
                    <ArticleRow article={article} key={article.id} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * One article in a topic's list, or one search hit.
 *
 * The fields come from the public search projection rather than being restated:
 * a list row is that same projection plus counters, so the two surfaces cannot
 * drift into rendering different fields from the same article.
 */
type ArticleRowItem = Pick<
  THelpCenterArticleSearchResult,
  "excerpt" | "id" | "isArchived" | "slug" | "title"
>;

/** One article in a topic's list. */
function ArticleRow({ article }: { article: ArticleRowItem }) {
  return (
    <li>
      <Link
        className="hover:bg-muted/50 flex items-start gap-3 px-4 py-3 transition-colors"
        params={{ articleSlug: article.slug }}
        to="/s/help/articles/$articleSlug"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{article.title}</span>
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
  );
}

/**
 * The ranked results for one query.
 *
 * A component of its own so the atom read only exists while there is a query to
 * read: hooks cannot be conditional, and mounting this is the condition. The
 * args are memoized because `helpCenterSearchPublicAtom` is a family keyed on
 * identity.
 */
function HelpCenterSearchResults({
  organizationId,
  query,
}: {
  organizationId: string;
  query: string;
}) {
  const args = useMemo<HelpCenterSearchAtomArgs>(
    () => ({ organizationId, query }),
    [organizationId, query]
  );

  const atom = helpCenterSearchPublicAtom(args);
  const result = useAtomValue(atom);
  const refresh = useAtomRefresh(atom);

  if (Result.isInitial(result)) {
    return (
      <div className="mt-6 space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  // A failed request is not "nothing matches": telling a reader the answer does
  // not exist because the network dropped is worse than saying so.
  if (Result.isFailure(result)) {
    return (
      <div className="mt-6 flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
        <p className="text-muted-foreground text-sm">
          Search could not be loaded.
        </p>
        <Button onClick={refresh} size="sm" type="button" variant="outline">
          Retry
        </Button>
      </div>
    );
  }

  const hits = Result.getOrElse(result, () => []);

  if (hits.length === 0) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>No matching articles</EmptyTitle>
          <EmptyDescription>
            Nothing in this help center matches “{query}”. Try a different
            search, or share the question with the team.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="mt-6">
      <p className="text-muted-foreground text-xs">
        {hits.length === 1 ? "1 article" : `${hits.length} articles`}
      </p>
      <ul className="mt-2 divide-y rounded-lg border">
        {hits.map((hit) => (
          <ArticleRow article={hit} key={hit.id} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Articles bucketed by topic, in one pass.
 *
 * A plain function rather than a `useMemo`: the page re-renders when a query
 * settles, not on every keystroke, and the list is bounded by what a help
 * center publishes. Filtering inside the topic loop would be O(topics ×
 * articles) per render for no benefit.
 */
function groupArticlesByTopic<Article extends { readonly topicId: string }>(
  articles: ReadonlyArray<Article>
): Map<string, Article[]> {
  const byTopic = new Map<string, Article[]>();

  for (const article of articles) {
    const bucket = byTopic.get(article.topicId);

    if (bucket === undefined) {
      byTopic.set(article.topicId, [article]);
    } else {
      bucket.push(article);
    }
  }

  return byTopic;
}
