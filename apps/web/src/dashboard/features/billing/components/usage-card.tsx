import { Badge } from "@feeblo/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@feeblo/ui/card";
import { Meter, MeterIndicator, MeterTrack } from "@feeblo/ui/meter";
import { Skeleton } from "@feeblo/ui/skeleton";
import {
  ContactIcon,
  DashboardSquare01Icon,
  Note01Icon,
  Tag01Icon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

import {
  useWorkspaceUsage,
  type WorkspaceUsageKey,
  type WorkspaceUsageRow,
} from "~/hooks/use-workspace-usage";

const USAGE_ICONS = {
  changelogCategories: Tag01Icon,
  crmEntries: ContactIcon,
  feedbackBoards: DashboardSquare01Icon,
  helpCenterArticles: Note01Icon,
  members: UserMultiple02Icon,
} as const satisfies Record<WorkspaceUsageKey, IconSvgElement>;

/**
 * Where this workspace sits against the limits of its plan.
 *
 * The meters read the same live collections the feature pages render, so they
 * move as the workspace changes instead of showing a snapshot from page load.
 */
export function WorkspaceUsageCard() {
  const rows = useWorkspaceUsage();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage</CardTitle>
        <CardDescription>
          How this workspace measures against its plan limits.
        </CardDescription>
      </CardHeader>
      <CardPanel className="p-0">
        <div className="border-border divide-border divide-y border-t">
          {rows.map((row) => (
            <UsageRow key={row.key} row={row} />
          ))}
        </div>
      </CardPanel>
    </Card>
  );
}

function UsageRow({ row }: { readonly row: WorkspaceUsageRow }) {
  const atLimit = row.limit !== null && row.used >= row.limit;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <HugeiconsIcon
          aria-hidden="true"
          className="text-muted-foreground size-4 shrink-0"
          icon={USAGE_ICONS[row.key]}
        />
        <span className="truncate text-sm">{row.label}</span>
        {atLimit ? (
          <Badge size="sm" variant="warning">
            Limit reached
          </Badge>
        ) : null}
      </div>
      <div className="w-full shrink-0 sm:w-56">
        {row.isLoading ? (
          <UsageRowSkeleton />
        ) : row.isUnavailable ? (
          <p className="text-muted-foreground text-xs">Usage unavailable</p>
        ) : (
          <UsageRowMeter atLimit={atLimit} row={row} />
        )}
      </div>
    </div>
  );
}

function UsageRowMeter({
  atLimit,
  row,
}: {
  readonly atLimit: boolean;
  readonly row: WorkspaceUsageRow;
}) {
  return (
    <>
      <div className="mb-2 flex items-baseline justify-between gap-2 text-xs tabular-nums">
        <span
          className={
            atLimit ? "text-warning-foreground font-medium" : "font-medium"
          }
        >
          {row.used} used
        </span>
        <span className="text-muted-foreground">
          {row.limit === null ? "Unlimited" : `${row.limit} included`}
        </span>
      </div>
      {row.limit === null ? (
        // Reserve the bar's height so a row without a ceiling keeps the
        // rhythm of the rows around it.
        <div className="h-1.5" />
      ) : (
        <Meter
          aria-label={`${row.label} usage`}
          aria-valuetext={`${row.used} of ${row.limit}`}
          max={row.limit}
          value={row.used}
        >
          <MeterTrack className="h-1.5 rounded-full">
            <MeterIndicator className={atLimit ? "bg-warning" : "bg-primary"} />
          </MeterTrack>
        </Meter>
      )}
    </>
  );
}

function UsageRowSkeleton() {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="h-1.5 w-full rounded-full" />
    </div>
  );
}
