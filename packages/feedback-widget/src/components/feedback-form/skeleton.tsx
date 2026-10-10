import { Skeleton } from "../ui/skeleton";

/** Matches the composer's final layout so the form does not jump on load. */
export function FeedbackFormSkeleton() {
  return (
    <div class="flex min-h-full flex-col p-6" role="status">
      <span class="sr-only">Loading board…</span>
      <Skeleton class="h-5 w-36" />
      <Skeleton class="mt-2.5 h-3.5 w-56 rounded-full" />
      <Skeleton class="mt-5 h-9 w-full rounded-lg" />
      <Skeleton class="mt-3 h-24 w-full rounded-lg" />
    </div>
  );
}
