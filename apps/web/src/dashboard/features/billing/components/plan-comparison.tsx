import type { TPlanPricing } from "@feeblo/domain/pricing/schema";
import { Badge } from "@feeblo/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@feeblo/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@feeblo/ui/table";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  buildPlanComparison,
  type PlanComparisonValue,
} from "../lib/comparison";
import type { PlanType } from "../lib/plans";

export function PlanComparison({
  catalog,
  currentPlanType,
}: {
  readonly catalog: readonly TPlanPricing[];
  readonly currentPlanType: PlanType;
}) {
  const { columns, rows } = buildPlanComparison(catalog);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compare plans</CardTitle>
        <CardDescription>
          Every limit and capability, side by side.
        </CardDescription>
      </CardHeader>
      <CardPanel className="p-0">
        <Table className="min-w-[36rem] [&_tbody_:is(td,th)]:py-3 [&_tbody_tr:last-child>*]:pb-5 [&_thead_th]:pt-0 [&_thead_th]:pb-4 [&_tr>:first-child]:pl-6 [&_tr>:last-child]:pr-6">
          <caption className="sr-only">
            Features and limits included in each plan
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Feature</TableHead>
              {columns.map((column) => (
                <TableHead
                  className="text-center"
                  key={column.planType}
                  scope="col"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {column.name}
                    {column.planType === currentPlanType ? (
                      <Badge size="sm" variant="secondary">
                        Current
                      </Badge>
                    ) : null}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableHead
                  className="text-muted-foreground h-auto text-left font-normal whitespace-normal"
                  scope="row"
                >
                  {row.label}
                </TableHead>
                {columns.map((column, index) => (
                  <TableCell
                    className="text-center tabular-nums"
                    key={column.planType}
                  >
                    <ComparisonValue value={row.values[index]} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-muted-foreground px-6 pb-5 text-xs">
          Limits apply to the workspace&apos;s own resources. End users and
          posts are unlimited on every plan.
        </p>
      </CardPanel>
    </Card>
  );
}

function ComparisonValue({ value }: { readonly value: PlanComparisonValue }) {
  if (value.kind === "limit") {
    return <>{value.limit === null ? "Unlimited" : value.limit}</>;
  }

  if (!value.included) {
    return (
      <>
        <span aria-hidden="true" className="text-muted-foreground/50">
          —
        </span>
        <span className="sr-only">Not included</span>
      </>
    );
  }

  return (
    <>
      <HugeiconsIcon
        aria-hidden="true"
        className="inline size-3.5 align-middle"
        icon={Tick02Icon}
        strokeWidth={2.2}
      />
      <span className="sr-only">Included</span>
    </>
  );
}
