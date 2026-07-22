import { usePostCollectionData } from "@feeblo/post-ui/post-page-context";
import { UpvoteButton } from "@feeblo/post-ui/upvote-toggle";
import { Skeleton } from "@feeblo/ui/skeleton";
import { cn } from "@feeblo/ui/utils";
import { UserAvatar } from "@feeblo/web-shared/components/user-avatar";
import { Link } from "@tanstack/react-router";
import { formatPostStatus, truncate } from "../../lib/utils";

const statusColors: Record<string, string> = {
  PENDING: "bg-muted-foreground/50",
  REVIEW: "bg-amber-500",
  PLANNED: "bg-blue-500",
  IN_PROGRESS: "bg-orange-500",
  COMPLETED: "bg-emerald-500",
  CLOSED: "bg-muted-foreground/30",
};

function StatusIndicator({ status }: { status: string }) {
  return (
    <div className="flex items-center gap-1.5" title={formatPostStatus(status)}>
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          statusColors[status] ?? "bg-muted-foreground/40"
        )}
      />
      <span className="whitespace-nowrap text-muted-foreground text-xs">
        {formatPostStatus(status)}
      </span>
    </div>
  );
}

export function FeedbackCard({ status }: { status: string }) {
  const { board, post } = usePostCollectionData();

  const description = truncate(post.excerpt, 100) || "No details yet.";

  return (
    <div className="group relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
      <Link
        aria-label={`View ${post.title}`}
        className="absolute inset-0 z-0 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-[-2px]"
        params={{
          slug: post.slug,
        }}
        to="/p/$slug"
      />

      <div className="relative z-10">
        <UpvoteButton variant="compact" />
      </div>

      <div className="pointer-events-none relative z-10 min-w-0 flex-1">
        <h3 className="truncate font-medium text-sm leading-snug">
          {post.title}
        </h3>
        <p className="mt-0.5 truncate text-muted-foreground text-xs">
          {description}
        </p>
        <div className="mt-2 flex items-center gap-2 text-muted-foreground text-xs sm:hidden">
          <UserAvatar image={post.user.image} name={post.user.name} />
          <span className="truncate">{post.user.name ?? "Anonymous"}</span>
          <span className="text-border">·</span>
          <span className="truncate">{board.name}</span>
        </div>
      </div>

      <div className="pointer-events-none relative z-10 hidden shrink-0 items-center gap-3 sm:flex">
        <StatusIndicator status={status} />
        <span className="rounded-full bg-muted/70 px-2 py-0.5 font-medium text-muted-foreground text-xs">
          {board.name}
        </span>
        <div className="flex items-center gap-2">
          <UserAvatar image={post.user.image} name={post.user.name} />
          <span className="truncate text-right text-muted-foreground text-xs">
            {post.user.name ?? "Anonymous"}
          </span>
        </div>
      </div>
    </div>
  );
}

export function FeedbackCardSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="h-9 w-10 rounded-md" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
      </div>
      <div className="hidden items-center gap-3 sm:flex">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}
