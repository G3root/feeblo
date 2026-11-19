import { useAtomValue } from "@effect/atom-react";
import {
  type THelpCenterAnalytics,
  type THelpCenterAnalyticsRange,
} from "@feeblo/domain/help-center-article/schema";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@feeblo/ui/card";
import { Skeleton } from "@feeblo/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@feeblo/ui/toggle-group";
import { Link } from "@tanstack/react-router";
import * as Result from "effect/reactivity/AsyncResult";
import { useMemo, useState } from "react";

import {
  DEFAULT_HELP_CENTER_ANALYTICS_RANGE,
  type HelpCenterAnalyticsAtomArgs,
  helpCenterAnalyticsAtom,
} from "../atoms";

const RANGE_LABELS = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
} as const satisfies Record<THelpCenterAnalyticsRange, string>;

/**
 * The help center's traffic, verdicts and searches.
 *
 * Three questions on one panel because they are read together: how much the
 * documentation is used, whether it answered, and what it failed to answer. The
 * third is the only one that names work to do, so it gets its own section and
 * the page links straight to the editor.
 *
 * A panel rather than a route: the index is where a member arrives when they
 * are thinking about the help center, and a separate analytics page would be a
 * second place to check for a workspace with a dozen articles.
 */
export function HelpCenterAnalytics({
  organizationId,
}: {
  organizationId: string;
}) {
  const [range, setRange] = useState<THelpCenterAnalyticsRange>(
    DEFAULT_HELP_CENTER_ANALYTICS_RANGE
  );

  const args = useMemo<HelpCenterAnalyticsAtomArgs>(
    () => ({ organizationId, range }),
    [organizationId, range]
  );

  const result = useAtomValue(helpCenterAnalyticsAtom(args));

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <h2 className="text-sm font-semibold">Documentation insights</h2>
          <p className="text-muted-foreground text-xs">
            Published and archived articles only. Reads and verdicts are counted
            on the portal.
          </p>
        </div>
        <ToggleGroup
          aria-label="Window"
          onValueChange={(value) => {
            const next = value[0];

            if (next === "7d" || next === "30d" || next === "90d") {
              setRange(next);
            }
          }}
          size="sm"
          value={[range]}
          variant="outline"
        >
          <ToggleGroupItem value="7d">7 days</ToggleGroupItem>
          <ToggleGroupItem value="30d">30 days</ToggleGroupItem>
          <ToggleGroupItem value="90d">90 days</ToggleGroupItem>
        </ToggleGroup>
      </header>

      {Result.builder(result)
        .onInitial(() => (
          <div className="grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ))
        .onFailure(() => (
          <Card size="sm">
            <CardHeader>
              <CardTitle>Insights could not be loaded</CardTitle>
              <CardDescription>
                The help center itself is unaffected; only this panel failed.
              </CardDescription>
            </CardHeader>
          </Card>
        ))
        .onSuccess((analytics) => (
          <AnalyticsContent
            analytics={analytics}
            organizationId={organizationId}
            range={range}
          />
        ))
        .exhaustive()}
    </section>
  );
}

function AnalyticsContent({
  analytics,
  organizationId,
  range,
}: {
  readonly analytics: THelpCenterAnalytics;
  readonly organizationId: string;
  readonly range: THelpCenterAnalyticsRange;
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
          <CardTitle>No traffic in the last {RANGE_LABELS[range]}</CardTitle>
          <CardDescription>
            Insights appear once readers open an article on the portal.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <TrafficTotals analytics={analytics} range={range} />

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
    </div>
  );
}

/** Views and the two verdict counts, with what each number is a share of. */
function TrafficTotals({
  analytics,
  range,
}: {
  readonly analytics: THelpCenterAnalytics;
  readonly range: THelpCenterAnalyticsRange;
}) {
  const { totals } = analytics;
  const verdicts = totals.helpful + totals.unhelpful;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Stat
        detail={`Across ${
          analytics.articles.length === 1
            ? "1 article"
            : `${analytics.articles.length} articles`
        } in the last ${RANGE_LABELS[range]}`}
        label="Views"
        value={totals.views}
      />
      <Stat
        detail={
          totals.helpful === 0
            ? "No helpful verdicts yet"
            : `${percentOf(totals.helpful, verdicts)} of verdicts`
        }
        label="Helpful"
        value={totals.helpful}
      />
      <Stat
        detail={
          totals.unhelpful === 0
            ? "Nothing rated unhelpful"
            : `${percentOf(totals.unhelpful, verdicts)} of verdicts`
        }
        label="Not helpful"
        value={totals.unhelpful}
      />
    </div>
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
        <CardDescription>
          Views, with the verdicts they collected.
        </CardDescription>
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
                to="/$organizationId/help-center/$articleId"
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
        <CardTitle>Documentation gaps</CardTitle>
        <CardDescription>
          Searches that returned nothing. An article for one of these closes the
          gap.
        </CardDescription>
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
        <CardDescription>
          What readers look for, most frequent first.
        </CardDescription>
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

function Stat({
  detail,
  label,
  value,
}: {
  readonly detail: string;
  readonly label: string;
  readonly value: number;
}) {
  return (
    <Card size="sm">
      <CardPanel className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </span>
        <span className="text-2xl font-semibold tracking-tight tabular-nums">
          {value.toLocaleString()}
        </span>
        <span className="text-muted-foreground text-xs text-pretty">
          {detail}
        </span>
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
