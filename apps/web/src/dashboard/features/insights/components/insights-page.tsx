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
import { ToggleGroup, ToggleGroupItem } from "@feeblo/ui/toggle-group";
import { ChartLineData01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import * as Result from "effect/reactivity/AsyncResult";
import * as React from "react";

import {
  DEFAULT_INSIGHTS_RANGE,
  type InsightsAtomArgs,
  type InsightsSummary,
  type WorkspaceInsights,
  workspaceInsightsAtom,
} from "../atoms";
import {
  InsightsStat,
  InsightsUntouchedPosts,
  InsightsStatusMix,
  InsightsTopBoards,
  InsightsTopTags,
  InsightsTopVoters,
  InsightsVolumeChart,
} from "./insights-sections";

const numberFormatter = new Intl.NumberFormat();

const RANGE_LABELS = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
} as const satisfies Record<TInsightsRange, string>;

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

export function InsightsPage({
  organizationId,
}: {
  readonly organizationId: string;
}) {
  const [range, setRange] = React.useState<TInsightsRange>(
    DEFAULT_INSIGHTS_RANGE
  );
  const args = React.useMemo<InsightsAtomArgs>(
    () => ({ organizationId, range }),
    [organizationId, range]
  );
  const atom = workspaceInsightsAtom(args);
  const result = useAtomValue(atom);
  const refresh = useAtomRefresh(atom);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight">
            Insights
          </h1>
          <p className="text-muted-foreground text-sm text-pretty">
            How feedback is moving through this workspace.
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
        .onInitial(() => <InsightsLoading />)
        .onFailure(() => <InsightsFailure onRetry={refresh} />)
        .onSuccess((insights) => (
          <InsightsContent
            insights={insights}
            organizationId={organizationId}
            range={range}
          />
        ))
        .exhaustive()}
    </div>
  );
}

function InsightsContent({
  insights,
  organizationId,
  range,
}: {
  readonly insights: WorkspaceInsights;
  readonly organizationId: string;
  readonly range: TInsightsRange;
}) {
  const { summary, subscriptions } = insights;
  const days = INSIGHTS_RANGE_DAYS[range];
  const rangeLabel = RANGE_LABELS[range];

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
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={ChartLineData01Icon} />
          </EmptyMedia>
          <EmptyTitle>No feedback to measure yet</EmptyTitle>
          <EmptyDescription>
            Once people post and vote, this page shows volume, response time,
            the status mix, and the posts waiting for an owner.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <p className="text-muted-foreground -mt-3 text-sm tabular-nums">
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
        <CardDescription>
          The request failed. Retrying asks the server again; the numbers are
          not cached anywhere else.
        </CardDescription>
      </CardHeader>
      <CardPanel>
        <Button onClick={onRetry} size="sm" variant="outline">
          Try again
        </Button>
      </CardPanel>
    </Card>
  );
}
