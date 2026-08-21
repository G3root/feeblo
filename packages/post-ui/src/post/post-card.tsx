import { Skeleton } from "@feeblo/ui/skeleton";
import { UserAvatar } from "@feeblo/ui/user-avatar";
import { cn } from "@feeblo/ui/utils";
import { getBoardStatusIndicatorColor } from "@feeblo/web-shared/board/constants";
import { Link } from "@tanstack/react-router";

// ---------------------------------------------------------------------------
// Shared composable PostCard — coss-style primitives (no useRender, no mergeProps)
// Composition over boolean props. Add a checkbox as child of Root; omit when not needed.
// ---------------------------------------------------------------------------

function formatPostStatus(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function StatusIndicator({ status }: { status: string }) {
  return (
    <div
      className="flex items-center gap-1.5"
      data-slot="post-card-status"
      title={formatPostStatus(status)}
    >
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          getBoardStatusIndicatorColor(status)
        )}
        data-slot="post-card-status-dot"
      />
      <span
        className="text-muted-foreground text-xs whitespace-nowrap"
        data-slot="post-card-status-label"
      >
        {formatPostStatus(status)}
      </span>
    </div>
  );
}

export function PostCardRoot({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "group/post-card hover:bg-muted/40 relative flex items-center gap-3 px-4 py-3 transition-colors",
        className
      )}
      data-slot="post-card"
      {...props}
    >
      {children}
    </div>
  );
}

export function PostCardLink({
  label,
  params,
  to,
}: {
  label?: string;
  params: Record<string, string>;
  to: string;
}) {
  return (
    <Link
      aria-label={label}
      className="focus-visible:outline-primary absolute inset-0 z-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
      data-slot="post-card-link"
      params={params}
      to={to}
    />
  );
}

export function PostCardMedia({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("relative z-10 shrink-0", className)}
      data-slot="post-card-media"
      {...props}
    >
      {children}
    </div>
  );
}

export function PostCardBody({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "pointer-events-none relative z-10 min-w-0 flex-1",
        className
      )}
      data-slot="post-card-body"
      {...props}
    >
      {children}
    </div>
  );
}

export function PostCardTitle({
  children,
  className,
  ...props
}: React.ComponentProps<"h3">) {
  return (
    <h3
      className={cn("truncate text-sm leading-snug font-medium", className)}
      data-slot="post-card-title"
      {...props}
    >
      {children}
    </h3>
  );
}

export function PostCardDescription({
  children,
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      className={cn("text-muted-foreground mt-0.5 truncate text-xs", className)}
      data-slot="post-card-description"
      {...props}
    >
      {children}
    </p>
  );
}

export function PostCardBoardBadge({
  children,
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "bg-muted/70 text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium",
        className
      )}
      data-slot="post-card-board-badge"
      {...props}
    >
      {children}
    </span>
  );
}

export function PostCardAuthor({
  image,
  name,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  image?: string | null;
  name?: string | null;
}) {
  return (
    <div
      className={cn("flex items-center gap-2", className)}
      data-slot="post-card-author"
      {...props}
    >
      <UserAvatar image={image} name={name} />
      <span
        className="text-muted-foreground truncate text-right text-xs"
        data-slot="post-card-author-name"
      >
        {name ?? "Anonymous"}
      </span>
    </div>
  );
}

export function PostCardStatus({ status }: { status: string }) {
  return <StatusIndicator status={status} />;
}

export function PostCardMobileMeta({
  boardName,
  image,
  name,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  boardName: string;
  image?: string | null;
  name?: string | null;
}) {
  return (
    <div
      className={cn(
        "text-muted-foreground mt-2 flex items-center gap-2 text-xs sm:hidden",
        className
      )}
      data-slot="post-card-mobile-meta"
      {...props}
    >
      <UserAvatar image={image} name={name} />
      <span className="truncate" data-slot="post-card-mobile-author">
        {name ?? "Anonymous"}
      </span>
      <span className="text-border" data-slot="post-card-mobile-separator">
        ·
      </span>
      <span className="truncate" data-slot="post-card-mobile-board">
        {boardName}
      </span>
    </div>
  );
}

export function PostCardDesktopMeta({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "pointer-events-none relative z-10 hidden shrink-0 items-center gap-3 sm:flex",
        className
      )}
      data-slot="post-card-desktop-meta"
      {...props}
    >
      {children}
    </div>
  );
}

export function PostCardSkeleton({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center gap-3 px-4 py-3", className)}
      data-slot="post-card-skeleton"
      {...props}
    >
      <Skeleton
        className="h-9 w-10 rounded-md"
        data-slot="post-card-skeleton-media"
      />
      <div
        className="min-w-0 flex-1 space-y-1.5"
        data-slot="post-card-skeleton-body"
      >
        <Skeleton className="h-3.5 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
      </div>
      <div
        className="hidden items-center gap-3 sm:flex"
        data-slot="post-card-skeleton-meta"
      >
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

export const PostCard = {
  Author: PostCardAuthor,
  BoardBadge: PostCardBoardBadge,
  Body: PostCardBody,
  Description: PostCardDescription,
  DesktopMeta: PostCardDesktopMeta,
  Link: PostCardLink,
  Media: PostCardMedia,
  MobileMeta: PostCardMobileMeta,
  Root: PostCardRoot,
  Skeleton: PostCardSkeleton,
  Status: PostCardStatus,
  Title: PostCardTitle,
} as const;
