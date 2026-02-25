import { Link } from "@tanstack/react-router";
import { Checkbox } from "~/components/ui/checkbox";
import { StatusIcon } from "./status-icon";
import type { BoardPostRow } from "./types";
import { formatPostDate, getToneForStatus } from "./utils";

export function BoardPostRowItem({
  post,
  boardSlug,
  organizationId,
}: {
  post: BoardPostRow;
  boardSlug: string;
  organizationId: string;
}) {
  const toneVar = getToneForStatus(post.status);

  return (
    <div className="group flex items-center gap-2 border-border/70 border-t px-4 py-3 transition-colors hover:bg-muted/50">
      <Checkbox
        aria-label={`Select ${post.title}`}
        className="pointer-events-none opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 data-checked:pointer-events-auto data-checked:opacity-100"
      />
      <Link
        className="flex min-w-0 flex-1 items-center justify-between gap-3"
        params={{
          organizationId,
          boardSlug,
          postSlug: post.slug,
        }}
        to="/$organizationId/board/$boardSlug/$postSlug"
      >
        <div className="flex min-w-0 items-center gap-2">
          <StatusIcon status={post.status} toneVar={toneVar} />
          <p className="truncate font-medium text-sm">{post.title}</p>
        </div>
        <span className="shrink-0 text-muted-foreground text-xs">
          {formatPostDate(post.updatedAt)}
        </span>
      </Link>
    </div>
  );
}
