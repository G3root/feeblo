import { Skeleton } from "../ui/skeleton";

/** Matches the update detail's typography so the article does not jump. */
export function UpdateDetailSkeleton() {
  return (
    <div class="p-6" role="status">
      <span class="sr-only">Loading update…</span>
      <Skeleton class="h-3 w-28 rounded-full" />
      <Skeleton class="mt-3 h-7 w-4/5" />
      <div class="mt-6 flex flex-col gap-3">
        <Skeleton class="h-3.5 w-full rounded-full" />
        <Skeleton class="h-3.5 w-full rounded-full" />
        <Skeleton class="h-3.5 w-2/3 rounded-full" />
        <Skeleton class="mt-2 h-3.5 w-full rounded-full" />
        <Skeleton class="h-3.5 w-5/6 rounded-full" />
      </div>
    </div>
  );
}
