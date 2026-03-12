import type { Board } from "@feeblo/domain/board/schema";
import type { Post } from "@feeblo/domain/post/schema";
import { ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { stripHtml, truncate } from "src/feature-board/lib/utils";
import { Link } from "wouter";
import { cn } from "~/lib/utils";

export function FeedbackCard({ board, post }: { board: Board; post: Post }) {
  const description =
    truncate(stripHtml(post.content), 120) || "No details yet.";

  return (
    <Link
      className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50"
      href={`/p/${post.slug}`}
    >
      <button
        className={cn(
          "mt-0.5 flex shrink-0 flex-col items-center rounded-md border px-2 py-1 text-xs transition-colors",
          post.hasUserUpVoted
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-transparent bg-muted text-muted-foreground hover:border-border"
        )}
        onClick={(e) => e.preventDefault()}
        type="button"
      >
        <HugeiconsIcon className="size-3.5" icon={ArrowUp01Icon} />
        <span className="font-medium tabular-nums">{post.upVotes}</span>
      </button>

      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-1 font-medium text-sm">{post.title}</h3>
        <p className="mt-0.5 line-clamp-1 text-muted-foreground text-xs">
          {description}
        </p>
        <div className="mt-1.5 flex items-center gap-2 text-muted-foreground text-xs">
          <span className="truncate">{post.user.name ?? "Anonymous"}</span>
          <span className="text-border">·</span>
          <span className="truncate">{board.name}</span>
        </div>
      </div>
    </Link>
  );
}
