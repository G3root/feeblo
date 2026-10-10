import { Skeleton } from "../ui/skeleton";

/** Matches the board list's final layout so data replaces shape, not space. */
export function BoardListSkeleton() {
  return (
    <div class="p-6" role="status">
      <span class="sr-only">Loading boards…</span>
      <Skeleton class="h-5 w-40" />
      <Skeleton class="mt-2.5 h-3.5 w-56 rounded-full" />
      <div class="mt-6 flex flex-col gap-2.5">
        <Skeleton class="h-[3.25rem] w-full rounded-xl" />
        <Skeleton class="h-[3.25rem] w-full rounded-xl" />
        <Skeleton class="h-[3.25rem] w-full rounded-xl" />
      </div>
    </div>
  );
}
