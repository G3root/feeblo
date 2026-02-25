import { Skeleton } from "~/components/ui/skeleton";

export function BoardPostsLoading() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((lane) => (
        <div className="space-y-2" key={lane}>
          <div className="flex items-center gap-2 px-4 py-1">
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Skeleton className="h-11 w-full rounded-none" />
          <Skeleton className="h-11 w-full rounded-none" />
        </div>
      ))}
    </div>
  );
}
