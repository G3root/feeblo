import { Skeleton } from "../ui/skeleton";

/** Matches the update list's card layout so the list does not jump on load. */
export function UpdatesListSkeleton() {
  return (
    <div class="p-6" role="status">
      <span class="sr-only">Loading updates…</span>
      <Skeleton class="h-5 w-36" />
      <Skeleton class="mt-2.5 h-3.5 w-52 rounded-full" />
      <div class="mt-6 flex flex-col gap-3">
        <Skeleton class="h-44 w-full rounded-xl" />
        <Skeleton class="h-28 w-full rounded-xl" />
      </div>
    </div>
  );
}
