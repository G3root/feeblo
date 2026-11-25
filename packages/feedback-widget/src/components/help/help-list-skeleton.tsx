import { Skeleton } from "../ui/skeleton";

/** Matches the help list's section-and-row layout so the list does not jump. */
export function HelpListSkeleton() {
  return (
    <div class="p-6" role="status">
      <span class="sr-only">Loading documentation…</span>
      <Skeleton class="h-5 w-28" />
      <Skeleton class="mt-2.5 h-3.5 w-52 rounded-full" />
      <Skeleton class="mt-6 h-3 w-24 rounded-full" />
      <div class="mt-3 flex flex-col gap-2">
        <Skeleton class="h-16 w-full rounded-lg" />
        <Skeleton class="h-16 w-full rounded-lg" />
      </div>
      <Skeleton class="mt-6 h-3 w-20 rounded-full" />
      <div class="mt-3 flex flex-col gap-2">
        <Skeleton class="h-16 w-full rounded-lg" />
      </div>
    </div>
  );
}
