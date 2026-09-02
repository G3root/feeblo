import { Badge } from "@feeblo/ui/badge";
import { CircleLockIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useCommentDisplay } from "./context";
import { formatRelativeTime } from "./utils";

export function CommentDisplayHeader() {
  const { state } = useCommentDisplay();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">{state.authorName}</span>
      <span className="text-muted-foreground text-xs">
        {formatRelativeTime(state.createdAt)}
      </span>
      {state.pinnedAt != null && (
        <Badge
          className="border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
          variant="default"
        >
          <svg
            aria-hidden="true"
            className="size-3"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
            <path d="M12 15v6" />
            <path d="M9 21h6" />
          </svg>
          Pinned
        </Badge>
      )}
      {state.isInternal && (
        <Badge variant="info">
          <HugeiconsIcon icon={CircleLockIcon} /> Internal
        </Badge>
      )}
    </div>
  );
}
