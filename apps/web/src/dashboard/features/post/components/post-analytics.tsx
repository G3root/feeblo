import { Button } from "@feeblo/ui/button";
import { Skeleton } from "@feeblo/ui/skeleton";
import { useQuery } from "@tanstack/react-query";

import {
  TrafficBreakdowns,
  TrafficTotals,
} from "~/components/traffic-breakdowns";

import { postTrafficQueryOptions } from "../lib/post-traffic-query";

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
      <TrafficTotals
        allTimeViews={views}
        label="Last 30 days"
        views={window.views}
      />

      {window.views === 0 ? (
        <p className="text-muted-foreground text-sm">
          No views in the last 30 days.
        </p>
      ) : (
        <TrafficBreakdowns
          browsers={window.browsers}
          countries={window.countries}
          devices={window.devices}
          os={window.os}
        />
      )}
    </div>
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
