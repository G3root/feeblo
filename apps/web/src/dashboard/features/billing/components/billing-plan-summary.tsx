import { Card, CardFooter, CardHeader, CardPanel } from "@feeblo/ui/card";
import { Skeleton } from "@feeblo/ui/skeleton";

export function CurrentPlanStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-xs tracking-wide uppercase">
        {label}
      </div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
export function PlanGridSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {["free", "starter", "professional"].map((key) => (
        <Card key={key} size="sm">
          <CardHeader className="space-y-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-28" />
          </CardHeader>
          <CardPanel className="space-y-4">
            <Skeleton className="h-px w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-10/12" />
          </CardPanel>
          <CardFooter>
            <Skeleton className="h-9 w-full" />
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
