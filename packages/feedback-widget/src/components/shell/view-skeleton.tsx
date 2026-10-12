import { Skeleton } from "../ui/skeleton";

/**
 * The root Suspense fallback: route chunks load behind a boundary the views
 * cannot own, so this only needs to hold the frame without jumping.
 */
export function ViewSkeleton() {
  return (
    <div class="p-6" role="status">
      <span class="sr-only">Loading…</span>
      <Skeleton class="h-5 w-40" />
      <Skeleton class="mt-3 h-3.5 w-56 rounded-full" />
      <Skeleton class="mt-6 h-14 w-full rounded-xl" />
      <Skeleton class="mt-3 h-14 w-full rounded-xl" />
    </div>
  );
}
