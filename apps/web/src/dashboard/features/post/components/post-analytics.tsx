import type { TPostViewDimensionCount } from "@feeblo/domain/post-traffic/schema";
import { Button } from "@feeblo/ui/button";
import { Skeleton } from "@feeblo/ui/skeleton";
import { useQuery } from "@tanstack/react-query";

import { postTrafficQueryOptions } from "../lib/post-traffic-query";

const countFormat = new Intl.NumberFormat();

/**
 * The Analytics tab: the last 30 days of post traffic, by dimension.
 *
 * The tab is lazy-loaded and its query is prefetched on hover/focus (see the
 * post route), so this module and its read are off the post's first load. The
 * payload is one RPC that already returns every dimension, so the panel renders
 * without a second round trip.
 */
export function PostAnalytics({
  organizationId,
  postId,
}: {
  readonly organizationId: string;
  readonly postId: string;
}) {
  const query = useQuery(postTrafficQueryOptions({ organizationId, postId }));

  if (query.isPending) {
    return <PostAnalyticsSkeleton />;
  }

  if (query.isError) {
    return (
      <div className="border-border/70 rounded-xl border p-5">
        <p className="text-muted-foreground text-sm">
          Unable to load analytics.
        </p>
        <Button
          className="mt-3"
          onClick={() => {
            void query.refetch();
          }}
          size="sm"
          variant="outline"
        >
          Try again
        </Button>
      </div>
    );
  }

  const { last30Days: window, views } = query.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <Metric label="Last 30 days" value={window.views} />
        <Metric label="All time" value={views} />
      </div>

      {window.views === 0 ? (
        <p className="text-muted-foreground text-sm">
          No views in the last 30 days.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <BreakdownCard rows={window.countries} title="Countries" />
          <BreakdownCard rows={window.devices} title="Devices" />
          <BreakdownCard rows={window.browsers} title="Browsers" />
          <BreakdownCard rows={window.os} title="Operating systems" />
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums">
        {countFormat.format(value)}
      </p>
    </div>
  );
}

/**
 * One dimension, ranked. The bar is relative to the dimension's own top value
 * so a quiet dimension stays readable instead of looking empty against the
 * all-time total.
 */
function BreakdownCard({
  rows,
  title,
}: {
  readonly rows: readonly TPostViewDimensionCount[];
  readonly title: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.views));

  return (
    <section className="border-border/70 rounded-xl border p-4">
      <h3 className="text-muted-foreground text-xs font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-xs">No data</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.map((row) => (
            <li className="space-y-1" key={row.value}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate">{row.value}</span>
                <span className="text-muted-foreground tabular-nums">
                  {countFormat.format(row.views)}
                </span>
              </div>
              <div
                aria-hidden="true"
                className="bg-muted h-1 overflow-hidden rounded-full"
              >
                <div
                  className="bg-foreground/35 h-full rounded-full"
                  style={{ width: `${(row.views / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PostAnalyticsSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex gap-8">
        <Skeleton className="h-12 w-24" />
        <Skeleton className="h-12 w-24" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
      </div>
    </div>
  );
}
