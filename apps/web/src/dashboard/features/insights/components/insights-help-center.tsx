import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type {
  THelpCenterAnalytics,
  THelpCenterAnalyticsRange,
} from "@feeblo/domain/help-center-article/schema";
import { Button } from "@feeblo/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@feeblo/ui/card";
import { Skeleton } from "@feeblo/ui/skeleton";
import { Link } from "@tanstack/react-router";
import * as Result from "effect/reactivity/AsyncResult";

import { helpCenterAnalyticsAtom } from "~/features/help-center/atoms";

import { InsightsStat } from "./insights-sections";

/**
 * What readers do with the documentation, over one window.
 *
 * Three questions, three panels: how much the help center is used, what it
 * failed to answer, and what people typed. The unanswered searches are the only
 * list that names work to do, so it sits beside the article list rather than at
 * the bottom.
 */
export function InsightsHelpCenter({
  organizationId,
  range,
  rangeLabel,
}: {
  readonly organizationId: string;
  readonly range: THelpCenterAnalyticsRange;
  readonly rangeLabel: string;
}) {
  // No `useMemo`: the atom family keys on the workspace and the window by
  // value, so a fresh object literal still resolves to the same atom.
  const atom = helpCenterAnalyticsAtom({ organizationId, range });
  const result = useAtomValue(atom);
  const refresh = useAtomRefresh(atom);

  return Result.builder(result)
    .onInitial(() => <HelpCenterLoading />)
    .onFailure(() => <HelpCenterFailure onRetry={refresh} />)
    .onSuccess((analytics) => (
      <HelpCenterContent
        analytics={analytics}
        organizationId={organizationId}
        rangeLabel={rangeLabel}
      />
    ))
    .exhaustive();
}

function HelpCenterContent({
  analytics,
  organizationId,
  rangeLabel,
}: {
  readonly analytics: THelpCenterAnalytics;
  readonly organizationId: string;
  readonly rangeLabel: string;
}) {
  const { totals } = analytics;

  const hasTraffic =
    totals.views > 0 ||
    totals.helpful > 0 ||
    totals.unhelpful > 0 ||
    analytics.queries.length > 0;

  if (!hasTraffic) {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle>
            No traffic in the last {rangeLabel.toLowerCase()}
          </CardTitle>
          <CardDescription>
            Views appear once readers open an article on your portal.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      <TrafficTotals analytics={analytics} rangeLabel={rangeLabel} />

      <div className="grid gap-3 lg:grid-cols-2">
        <ArticleTrafficCard
          articles={analytics.articles}
          organizationId={organizationId}
        />
        <SearchGapsCard
          emptyQueries={analytics.emptyQueries}
          queries={analytics.queries}
        />
      </div>

      {analytics.queries.length === 0 ? null : (
        <TopSearchesCard queries={analytics.queries} />
      )}
    </>
  );
}

/** Views and the two verdict counts, with what each number is a share of. */
function TrafficTotals({
  analytics,
  rangeLabel,
}: {
  readonly analytics: THelpCenterAnalytics;
  readonly rangeLabel: string;
}) {
  const { totals } = analytics;
  const verdicts = totals.helpful + totals.unhelpful;

  return (
    <section className="grid gap-3 sm:grid-cols-3">
      {/*
       * No article count here. `articles` is the top ten by views, so a count
       * of it would read as "the help center has ten articles" on any
       * workspace bigger than that. The views total is the whole window and
       * needs no such qualifier.
       */}
      <InsightsStat
        detail={`In the last ${rangeLabel}`}
        label="Views"
        value={totals.views.toLocaleString()}
      />
      <InsightsStat
        detail={
          totals.helpful === 0
            ? "No helpful verdicts yet"
            : `${percentOf(totals.helpful, verdicts)} of verdicts`
        }
        label="Helpful"
        value={totals.helpful.toLocaleString()}
      />
      <InsightsStat
        detail={
          totals.unhelpful === 0
            ? "Nothing rated unhelpful"
            : `${percentOf(totals.unhelpful, verdicts)} of verdicts`
        }
        label="Not helpful"
        value={totals.unhelpful.toLocaleString()}
      />
    </section>
  );
}

function ArticleTrafficCard({
  articles,
  organizationId,
}: {
  readonly articles: THelpCenterAnalytics["articles"];
  readonly organizationId: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Most-read articles</CardTitle>
        <CardDescription>Views and verdicts per article.</CardDescription>
      </CardHeader>
      <CardPanel className="pt-0">
        <ul className="divide-y">
          {articles.map((article) => (
            <li
              className="flex items-baseline justify-between gap-3 py-2"
              key={article.id}
            >
              <Link
                className="hover:underline"
                params={{ articleId: article.id, organizationId }}
                to="/$organizationId/help-center/article/$articleId"
              >
                <span className="text-sm">{article.title}</span>
                {article.status === "draft" ? (
                  <span className="text-muted-foreground ml-2 text-xs">
                    draft
                  </span>
                ) : null}
              </Link>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {article.views} views · {article.helpful}↑ {article.unhelpful}↓
              </span>
            </li>
          ))}
        </ul>
      </CardPanel>
    </Card>
  );
}

function SearchGapsCard({
  emptyQueries,
  queries,
}: {
  readonly emptyQueries: THelpCenterAnalytics["emptyQueries"];
  readonly queries: THelpCenterAnalytics["queries"];
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Unanswered searches</CardTitle>
        <CardDescription>Searches that returned nothing.</CardDescription>
      </CardHeader>
      <CardPanel className="pt-0">
        {emptyQueries.length === 0 ? (
          <p className="text-muted-foreground py-2 text-sm">
            {queries.length === 0
              ? "Nobody has searched the help center yet."
              : "Every search so far found something."}
          </p>
        ) : (
          <ul className="divide-y">
            {emptyQueries.map((query) => (
              <li
                className="flex items-baseline justify-between gap-3 py-2"
                key={query.query}
              >
                <span className="truncate text-sm">{query.query}</span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {query.emptySearches} of {query.searches} found nothing
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardPanel>
    </Card>
  );
}

function TopSearchesCard({
  queries,
}: {
  readonly queries: THelpCenterAnalytics["queries"];
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Top searches</CardTitle>
        <CardDescription>What readers look for.</CardDescription>
      </CardHeader>
      <CardPanel className="pt-0">
        <ul className="flex flex-wrap gap-1.5">
          {queries.map((query) => (
            <li
              className="bg-muted flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
              key={query.query}
            >
              <span className="max-w-52 truncate">{query.query}</span>
              <span className="text-muted-foreground tabular-nums">
                {query.searches}
              </span>
            </li>
          ))}
        </ul>
      </CardPanel>
    </Card>
  );
}

function HelpCenterLoading() {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
    </>
  );
}

function HelpCenterFailure({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Help center insights could not be loaded</CardTitle>
        <CardDescription>Try again to reload these numbers.</CardDescription>
      </CardHeader>
      <CardPanel>
        <Button onClick={onRetry} size="sm" variant="outline">
          Try again
        </Button>
      </CardPanel>
    </Card>
  );
}

/**
 * A whole-number percentage, and a dash when there is nothing to divide.
 *
 * "0 of 0" is not 0% — it is no verdicts — and rendering it as 0% would read as
 * "everyone hated it".
 */
function percentOf(part: number, whole: number): string {
  if (whole <= 0) {
    return "no verdicts";
  }

  return `${Math.round((part / whole) * 100)}%`;
}
