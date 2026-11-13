import type { TPostViewDimensionCount } from "@feeblo/domain/post-traffic/schema";
import { Card, CardHeader, CardPanel, CardTitle } from "@feeblo/ui/card";

const countFormat = new Intl.NumberFormat();

/**
 * The two totals every traffic surface shows: the selected window and the
 * all-time counter.
 *
 * Shared by the post detail's Analytics tab and the insights page so the two
 * cannot disagree about what "views" looks like or how it is formatted.
 */
export function TrafficTotals({
  allTimeViews,
  label,
  views,
}: {
  readonly allTimeViews: number;
  readonly label: string;
  readonly views: number;
}) {
  return (
    <section className="grid gap-3 sm:grid-cols-2">
      <TrafficTotalCard label={label} value={views} />
      <TrafficTotalCard label="All time" value={allTimeViews} />
    </section>
  );
}

function TrafficTotalCard({
  label,
  value,
}: {
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
          {countFormat.format(value)}
        </span>
      </CardPanel>
    </Card>
  );
}

/**
 * The four dimensions, ranked, each bar relative to its own top value.
 *
 * A relative bar is what keeps a quiet dimension readable; scaling against the
 * all-time total would flatten every non-country row to a sliver.
 */
export function TrafficBreakdowns({
  browsers,
  countries,
  devices,
  os,
}: {
  readonly browsers: readonly TPostViewDimensionCount[];
  readonly countries: readonly TPostViewDimensionCount[];
  readonly devices: readonly TPostViewDimensionCount[];
  readonly os: readonly TPostViewDimensionCount[];
}) {
  return (
    <section className="grid gap-3 md:grid-cols-2">
      <TrafficBreakdownCard rows={countries} title="Countries" />
      <TrafficBreakdownCard rows={devices} title="Devices" />
      <TrafficBreakdownCard rows={browsers} title="Browsers" />
      <TrafficBreakdownCard rows={os} title="Operating systems" />
    </section>
  );
}

function TrafficBreakdownCard({
  rows,
  title,
}: {
  readonly rows: readonly TPostViewDimensionCount[];
  readonly title: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.views));

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardPanel>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-xs">No data</p>
        ) : (
          <ul className="space-y-2.5">
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
                    className="bg-primary/45 h-full rounded-full"
                    style={{ width: `${(row.views / max) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardPanel>
    </Card>
  );
}
