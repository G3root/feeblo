import { Skeleton } from "@feeblo/ui/skeleton";

import {
  TrafficBreakdowns,
  TrafficTotals,
} from "~/components/traffic-breakdowns";

import type { WorkspaceTraffic } from "../atoms";

/**
 * The insights page's traffic section.
 *
 * It mirrors the post detail's Analytics tab — same totals, same four ranked
 * dimensions — because two surfaces answering "where do views come from"
 * differently would be a bug, not a feature. The window is the page's range
 * toggle.
 */
export function InsightsTraffic({
  rangeLabel,
  traffic,
}: {
  readonly rangeLabel: string;
  readonly traffic: WorkspaceTraffic;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Traffic</h2>
        <p className="text-muted-foreground text-sm">
          Views of your public posts.
        </p>
      </div>

      <TrafficTotals
        allTimeViews={traffic.allTimeViews}
        label={rangeLabel}
        views={traffic.views}
      />

      {traffic.views === 0 ? (
        <p className="text-muted-foreground text-sm">No views in this range.</p>
      ) : (
        <TrafficBreakdowns
          browsers={traffic.browsers}
          countries={traffic.countries}
          devices={traffic.devices}
          os={traffic.os}
        />
      )}
    </section>
  );
}

export function InsightsTrafficSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    </div>
  );
}
