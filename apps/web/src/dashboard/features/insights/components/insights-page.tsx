import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  INSIGHTS_RANGE_DAYS,
  type TInsightsRange,
} from "@feeblo/domain/insights/schema";
import { Button } from "@feeblo/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@feeblo/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { Skeleton } from "@feeblo/ui/skeleton";
import { toggleVariants } from "@feeblo/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@feeblo/ui/toggle-group";
import { ChartLineData01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import * as Result from "effect/reactivity/AsyncResult";
import * as React from "react";

import {
  type InsightsAtomArgs,
  type InsightsSummary,
  type WorkspaceInsights,
  workspaceInsightsAtom,
  workspaceTrafficAtom,
} from "../atoms";
import { InsightsHelpCenter } from "./insights-help-center";
import { InsightsPrefetch } from "./insights-prefetch";
import {
  InsightsStat,
  InsightsUntouchedPosts,
  InsightsStatusMix,
  InsightsTopBoards,
  InsightsTopTags,
  InsightsTopVoters,
  InsightsVolumeChart,
} from "./insights-sections";
import {
  InsightsTraffic,
  InsightsTrafficFailure,
  InsightsTrafficSkeleton,
} from "./insights-traffic";

const numberFormatter = new Intl.NumberFormat();

/** Which half of the page is showing. The route, not local state, owns it. */
export type InsightsTab = "feedback" | "help-center";

const RANGE_LABELS = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
} as const satisfies Record<TInsightsRange, string>;

/** Narrowest first, matching the toggle's left-to-right order. */
const RANGE_OPTIONS = [
  "7d",
  "30d",
  "90d",
] as const satisfies readonly TInsightsRange[];

/** A duration as a coarse, readable span: "3h 12m", "2d 4h". */
function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return "—";
  }

  if (seconds < 60) {
    return "<1m";
  }

  if (seconds < 3_600) {
    return `${Math.round(seconds / 60)}m`;
  }

  if (seconds < 86_400) {
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.round((seconds % 3_600) / 60);

    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }

  const days = Math.floor(seconds / 86_400);
  const hours = Math.round((seconds % 86_400) / 3_600);

  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "—";
  }

  if (value > 0 && value < 0.01) {
    return "<1%";
  }

  return `${Math.round(value * 100)}%`;
}

function plural(count: number, singular: string): string {
  return `${numberFormatter.format(count)} ${singular}${count === 1 ? "" : "s"}`;
}

/**
 * The workspace's numbers, split into the two things they measure.
 *
 * Feedback and help center traffic answer different questions and are collected
 * by different operations, so they get a tab each rather than sharing one range
 * of cards. The window is the route's search param (`insights/search.ts`),
 * which is what lets it outlive the remount a tab switch causes.
 */
export function InsightsPage({
  onRangeChange,
  organizationId,
  range,
  tab,
}: {
  readonly onRangeChange: (range: TInsightsRange) => void;
  readonly organizationId: string;
  readonly range: TInsightsRange;
  readonly tab: InsightsTab;
}) {
  return (
    <div className="mx-auto w-full">
      <InsightsToolbar
        onRangeChange={onRangeChange}
        organizationId={organizationId}
        range={range}
        tab={tab}
      />
      <div className="space-y-3 p-3">
        {tab === "feedback" ? (
          <FeedbackInsights
            organizationId={organizationId}
            range={range}
            rangeLabel={RANGE_LABELS[range]}
          />
        ) : (
          <InsightsHelpCenter
            organizationId={organizationId}
            range={range}
            rangeLabel={RANGE_LABELS[range]}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The page's tabs and window, in one row above the content.
 *
 * The tabs are links because each one is a route, which is what makes the
 * section bookmarkable and what keeps the range toggle from resetting the page
 * it applies to. Each link carries the current window, so a tab switch keeps
 * the range the reader chose. The styling is the changelog toolbar's, so the
 * two lists read as the same control.
 */
function InsightsToolbar({
  onRangeChange,
  organizationId,
  range,
  tab,
}: {
  readonly onRangeChange: (range: TInsightsRange) => void;
  readonly organizationId: string;
  readonly range: TInsightsRange;
  readonly tab: InsightsTab;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <Link
          activeOptions={{ exact: true }}
          activeProps={{ "data-pressed": "true" }}
          className={toggleVariants({ size: "sm", variant: "outline" })}
          params={{ organizationId }}
          search={{ range }}
          to="/$organizationId/insights"
        >
          Feedback
        </Link>
        <Link
          activeOptions={{ exact: true }}
          activeProps={{ "data-pressed": "true" }}
          className={toggleVariants({ size: "sm", variant: "outline" })}
          params={{ organizationId }}
          search={{ range }}
          to="/$organizationId/insights/help-center"
        >
          Help center
        </Link>
      </div>

      <InsightsRangeToggle
        onRangeChange={onRangeChange}
        organizationId={organizationId}
        range={range}
        tab={tab}
      />
    </div>
  );
}

/**
 * The window toggle, with a prefetch on intent.
 *
 * Each option is a cache entry keyed by window, so starting that entry's reads
 * when the pointer or focus reaches the option means picking it joins an
 * in-flight request instead of starting one. The help center tab has nothing to
 * warm here: its own reads start when the tab is opened.
 */
function InsightsRangeToggle({
  onRangeChange,
  organizationId,
  range,
  tab,
}: {
  readonly onRangeChange: (range: TInsightsRange) => void;
  readonly organizationId: string;
  readonly range: TInsightsRange;
  readonly tab: InsightsTab;
}) {
  const [warmRange, setWarmRange] = React.useState<TInsightsRange | null>(null);

  return (
    <>
      <ToggleGroup
        aria-label="Window"
        onValueChange={(value) => {
          const next = value[0];

          if (next === "7d" || next === "30d" || next === "90d") {
            onRangeChange(next);
          }
        }}
        size="sm"
        value={[range]}
        variant="outline"
      >
        {RANGE_OPTIONS.map((option) => (
          <ToggleGroupItem
            key={option}
            onFocus={() => setWarmRange(option)}
            onMouseEnter={() => setWarmRange(option)}
            value={option}
          >
            {RANGE_LABELS[option]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {tab === "help-center" ||
      warmRange === null ||
      warmRange === range ? null : (
        <InsightsPrefetch organizationId={organizationId} range={warmRange} />
      )}
    </>
  );
}

function FeedbackInsights({
  organizationId,
  range,
  rangeLabel,
}: {
  readonly organizationId: string;
  readonly range: TInsightsRange;
  readonly rangeLabel: string;
}) {
  const args = React.useMemo<InsightsAtomArgs>(
    () => ({ organizationId, range }),
    [organizationId, range]
  );

  const atom = workspaceInsightsAtom(args);
  const result = useAtomValue(atom);
  const refresh = useAtomRefresh(atom);
  // Started next to the insights read, not after it: the two are independent
  // sources, and a second round trip behind the first would be a waterfall.
  const trafficAtom = workspaceTrafficAtom(args);
  const trafficResult = useAtomValue(trafficAtom);
  const refreshTraffic = useAtomRefresh(trafficAtom);

  const trafficSection = Result.builder(trafficResult)
    .onInitial(() => <InsightsTrafficSkeleton />)
    .onFailure(() => <InsightsTrafficFailure onRetry={refreshTraffic} />)
    .onSuccess((traffic) => (
      <InsightsTraffic rangeLabel={rangeLabel} traffic={traffic} />
    ))
    .exhaustive();

  return Result.builder(result)
    .onInitial(() => <InsightsLoading />)
    .onFailure(() => <InsightsFailure onRetry={refresh} />)
    .onSuccess((insights) => (
      <InsightsContent
        insights={insights}
        organizationId={organizationId}
        range={range}
        rangeLabel={rangeLabel}
        trafficSection={trafficSection}
      />
    ))
    .exhaustive();
}

function InsightsContent({
  insights,
  organizationId,
  range,
  rangeLabel,
  trafficSection,
}: {
  readonly insights: WorkspaceInsights;
  readonly organizationId: string;
  readonly range: TInsightsRange;
  readonly rangeLabel: string;
  readonly trafficSection: React.ReactNode;
}) {
  const { summary, subscriptions } = insights;
  const days = INSIGHTS_RANGE_DAYS[range];

  // A workspace can have no active posts and nothing new in the window and
  // still have real data: votes on posts that were later archived, merges, or
  // changelog followers. Only the completely empty workspace gets the
  // first-run state.
  const hasActivity =
    summary.activePosts > 0 ||
    summary.posts > 0 ||
    summary.votes > 0 ||
    summary.mergedPosts > 0 ||
    subscriptions.posts > 0 ||
    subscriptions.changelog > 0;

  if (!hasActivity) {
    return (
      <>
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={ChartLineData01Icon} />
            </EmptyMedia>
            <EmptyTitle>No feedback yet</EmptyTitle>
            <EmptyDescription>
              Volume, response time, and the status mix appear once people post
              and vote.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
        {/* Traffic is independent of the feedback activity above; a workspace
            whose posts were archived still has views worth showing. */}
        {trafficSection}
      </>
    );
  }

  return (
    <>
      <p className="text-muted-foreground text-sm tabular-nums">
        {plural(subscriptions.posts, "post follower")} ·{" "}
        {plural(subscriptions.changelog, "changelog follower")}
      </p>

      <InsightsSummaryCards
        days={days}
        rangeLabel={rangeLabel}
        summary={summary}
      />

      <section className="grid gap-3 lg:grid-cols-2">
        <InsightsVolumeChart
          description={`New posts per day, UTC. The last ${days} days.`}
          metric="posts"
          points={insights.volume}
          title="Posts per day"
        />
        <InsightsVolumeChart
          description={`Votes cast per day, UTC. The last ${days} days.`}
          metric="votes"
          points={insights.volume}
          title="Votes per day"
        />
      </section>

      {trafficSection}

      <section className="grid gap-3 lg:grid-cols-2">
        <InsightsStatusMix
          activePosts={summary.activePosts}
          slices={insights.statusMix}
          unassignedPosts={summary.unassignedPosts}
        />
        <InsightsUntouchedPosts
          organizationId={organizationId}
          posts={insights.untouchedPosts}
        />
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <InsightsTopBoards
          boards={insights.topBoards}
          organizationId={organizationId}
        />
        <InsightsTopTags tags={insights.topTags} />
        <InsightsTopVoters voters={insights.topVoters} />
      </section>
    </>
  );
}

function InsightsSummaryCards({
  days,
  rangeLabel,
  summary,
}: {
  readonly days: number;
  readonly rangeLabel: string;
  readonly summary: InsightsSummary;
}) {
  const responseDetail =
    summary.respondedPosts === 0
      ? "No post has been answered yet"
      : `median over ${plural(summary.respondedPosts, "answered post")}`;

  // Two separate quantities: a post merged in the window may have been
  // created before it, so "N of M new posts" would describe a rate the data
  // does not support.
  const mergeDetail =
    summary.posts === 0 && summary.mergedPosts === 0
      ? "No posts in this window"
      : `${plural(summary.mergedPosts, "merged post")} · ${plural(summary.posts, "new post")}`;

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <InsightsStat
        detail={`${rangeLabel} · ${plural(summary.activePosts, "active post")} now`}
        label="Posts created"
        value={numberFormatter.format(summary.posts)}
      />
      <InsightsStat
        detail={`Cast in the last ${days} days`}
        label="Votes"
        value={numberFormatter.format(summary.votes)}
      />
      <InsightsStat
        detail={responseDetail}
        label="First response"
        value={formatDuration(summary.medianFirstResponseSeconds)}
      />
      <InsightsStat
        detail={mergeDetail}
        label="Merge rate"
        value={formatPercent(summary.mergeRate)}
      />
    </section>
  );
}

function InsightsLoading() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton className="h-28 rounded-2xl" key={`stat-${index}`} />
      ))}
    </div>
  );
}

function InsightsFailure({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Insights could not be loaded</CardTitle>
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
