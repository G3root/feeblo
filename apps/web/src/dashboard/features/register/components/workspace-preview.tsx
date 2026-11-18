import { UserAvatar } from "@feeblo/ui/user-avatar";
import { cn } from "@feeblo/ui/utils";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import {
  AlertCircleIcon,
  ArrowUp02Icon,
  CheckmarkCircle02Icon,
  Loading03Icon,
  LockIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { WorkspaceSlugAvailability } from "../hooks/use-slug-availability";
import type { RegisterBoardDraft } from "../lib/register-draft";

/**
 * The workspace the reader is about to create, rendered as the public board it
 * will be.
 *
 * A preview is worth showing only if it is the truth about the fields above
 * it: the name in the header is the name being typed, the address in the bar
 * is the subdomain the server is checking, and the board it shows is laid out
 * the way `{subdomain}.{rootDomain}` lays it out. The rows inside are static because they
 * are the sample posts the new workspace opens with, and inventing
 * live data for a workspace that does not exist yet would be a fiction with a
 * loading state.
 *
 * Rendered at its natural size inside a fluid column rather than as a scaled
 * down desktop window: the register form is a narrow column on a wide screen,
 * so the board only has to look right at one width, and type that stays at its
 * real size reads as a product instead of a screenshot.
 */

/** Where the address bar's subdomain ends and the shared root begins. */
const appRootDomain = () => getRuntimePublicEnv().appRootDomain ?? "";

const placeholderName = "Your workspace";

const placeholderSlug = "your-workspace";

/**
 * The three sample posts every workspace opens with, as the board will show
 * them. Kept in step with `packages/domain/src/workspace/onboarding.ts` by
 * naming the same three posts, not by importing the templates: the server's
 * copy is the one that ships, and this is a picture of it.
 *
 * All three are Pending because that is the status the seed writes. A preview
 * that showed one of them Planned would be describing a workspace the reader
 * is not about to get.
 */
const previewPosts = [
  {
    status: "Pending",
    statusClassName: "bg-muted-foreground/60",
    title: "Welcome to your workspace",
    votes: 0,
  },
  {
    status: "Pending",
    statusClassName: "bg-muted-foreground/60",
    title: "How ideas become roadmap items",
    votes: 0,
  },
  {
    status: "Pending",
    statusClassName: "bg-muted-foreground/60",
    title: "What makes a bug report useful",
    votes: 0,
  },
] as const;

function AvailabilityBadge({
  status,
  suggestion,
}: Pick<WorkspaceSlugAvailability["availability"], "status" | "suggestion">) {
  if (status === "checking") {
    return (
      <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
        <HugeiconsIcon className="size-3 animate-spin" icon={Loading03Icon} />
        Checking
      </span>
    );
  }

  if (status === "available") {
    return (
      <span className="flex items-center gap-1 text-[11px] text-emerald-600">
        <HugeiconsIcon className="size-3" icon={CheckmarkCircle02Icon} />
        Available
      </span>
    );
  }

  if (status === "taken") {
    return (
      <span className="text-destructive flex items-center gap-1 text-[11px]">
        <HugeiconsIcon className="size-3" icon={AlertCircleIcon} />
        {suggestion ?? "Taken"}
      </span>
    );
  }

  if (status === "error") {
    return (
      <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
        <HugeiconsIcon className="size-3" icon={AlertCircleIcon} />
        Unchecked
      </span>
    );
  }

  return null;
}

function AddressBar({
  slug,
  status,
  suggestion,
}: {
  readonly slug: string;
  readonly status: WorkspaceSlugAvailability["availability"]["status"];
  readonly suggestion: string | null;
}) {
  const root = appRootDomain();
  const subdomain = slug.trim() || placeholderSlug;

  return (
    <div className="border-border/60 bg-muted/50 flex items-center gap-3 border-b px-3 py-2">
      <span aria-hidden className="flex gap-1.5">
        <span className="bg-border size-2.5 rounded-full" />
        <span className="bg-border size-2.5 rounded-full" />
        <span className="bg-border size-2.5 rounded-full" />
      </span>
      <span className="bg-background text-muted-foreground flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-[11px]">
        <HugeiconsIcon className="size-2.5 shrink-0" icon={LockIcon} />
        <span className="truncate">
          {subdomain}
          {root ? `.${root}` : ""}
        </span>
      </span>
      <span className="flex shrink-0 justify-end">
        <AvailabilityBadge status={status} suggestion={suggestion} />
      </span>
    </div>
  );
}

function PreviewRow({
  post,
}: {
  readonly post: (typeof previewPosts)[number];
}) {
  return (
    <div className="border-border/60 bg-background flex items-center gap-3 rounded-xl border px-3 py-2.5">
      <span className="text-muted-foreground flex w-9 shrink-0 flex-col items-center rounded-md border py-1 text-[11px] font-medium tabular-nums">
        <HugeiconsIcon className="size-3.5" icon={ArrowUp02Icon} />
        {post.votes}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{post.title}</span>
        <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
          <span
            aria-hidden
            className={cn("size-1.5 rounded-full", post.statusClassName)}
          />
          {post.status}
        </span>
      </span>
    </div>
  );
}

export function WorkspacePreview({
  boards,
  logoUrl,
  status,
  subdomain,
  suggestion,
  workspaceName,
}: {
  readonly boards: readonly RegisterBoardDraft[];
  readonly logoUrl: string | null;
  readonly status: WorkspaceSlugAvailability["availability"]["status"];
  readonly subdomain: string;
  readonly suggestion: string | null;
  readonly workspaceName: string;
}) {
  const name = workspaceName.trim() || placeholderName;

  const visibleBoards = boards.filter(
    (board) => board.enabled && board.name.trim().length > 0
  );

  return (
    <div className="border-border/60 bg-card flex h-full min-h-0 flex-col overflow-hidden rounded-xl border shadow-xl shadow-black/5">
      <AddressBar slug={subdomain} status={status} suggestion={suggestion} />

      {/* The public board's header, which is what the subdomain serves. */}
      <header className="border-border/60 bg-background/80 shrink-0 border-b px-5">
        <div className="flex h-14 items-center gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <UserAvatar image={logoUrl} name={name} />
            <span className="truncate text-sm font-semibold tracking-tight">
              {name}
            </span>
          </div>
          <nav className="text-muted-foreground hidden items-center gap-3 text-xs sm:flex">
            <span className="text-foreground">Feedback</span>
            <span>Roadmap</span>
            <span>Changelog</span>
          </nav>
        </div>
      </header>

      {/* The boards the reader kept, as the board list will show them. */}
      <div className="border-border/60 flex shrink-0 items-center gap-2 overflow-x-auto border-b px-5 py-2">
        {visibleBoards.length === 0 ? (
          <span className="text-muted-foreground text-xs">No boards yet</span>
        ) : (
          visibleBoards.map((board) => (
            <span
              className="bg-muted text-muted-foreground rounded-md px-2 py-1 text-xs"
              key={board.id}
            >
              {board.name}
            </span>
          ))
        )}
      </div>

      {/* The board's own scroller: the page never scrolls, the list does, the
          way it will once this board exists. */}
      <div className="bg-muted/30 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-5">
        <div className="text-muted-foreground flex items-center justify-between px-1 text-xs">
          <span className="text-foreground font-medium">All feedback</span>
          <span>Newest</span>
        </div>

        {previewPosts.map((post) => (
          <PreviewRow key={post.title} post={post} />
        ))}
      </div>

      <p className="border-border/60 text-muted-foreground shrink-0 border-t px-5 py-3 text-[11px] leading-relaxed">
        Three sample posts are added to every new workspace, and you can delete
        them whenever you like.
      </p>
    </div>
  );
}
