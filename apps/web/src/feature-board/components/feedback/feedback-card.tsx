import type { Board } from "@feeblo/domain/board/schema";
import type { Post } from "@feeblo/domain/post/schema";
import { ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  formatPostStatus,
  getInitials,
  stripHtml,
  truncate,
} from "src/feature-board/lib/utils";
import { Link } from "wouter";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

const statusColors: Record<string, string> = {
  PAUSED: "bg-muted-foreground/50",
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

function UserAvatar({
  image,
  name,
}: {
  image: string | null;
  name: string | null;
}) {
  const initials = getInitials(name);

  return (
    <Avatar size="sm">
      {image ? <AvatarImage alt={name ?? "User avatar"} src={image} /> : null}
      <AvatarFallback>{initials}</AvatarFallback>
    </Avatar>
  );
}

export function FeedbackCard({ board, post }: { board: Board; post: Post }) {
  const description =
    truncate(stripHtml(post.content), 100) || "No details yet.";

  return (
    <Link
      className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
      href={`/p/${post.slug}`}
    >
      <button
        className={cn(
          "flex h-9 w-10 shrink-0 flex-col items-center justify-center rounded-md text-xs transition-colors",
          post.hasUserUpVoted
            ? "bg-primary/10 text-primary"
            : "bg-muted/70 text-muted-foreground hover:bg-muted"
        )}
        onClick={(e) => e.preventDefault()}
        type="button"
      >
        <HugeiconsIcon className="size-3" icon={ArrowUp01Icon} />
        <span className="font-medium text-xs tabular-nums leading-none">
          {post.upVotes}
        </span>
      </button>

      <div className="min-w-0 flex-1">
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

      <div className="hidden shrink-0 items-center gap-3 sm:flex">
        <StatusIndicator status={post.status} />
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
    </Link>
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
