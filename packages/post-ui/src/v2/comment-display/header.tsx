import { Badge } from "@feeblo/ui/badge";
import { CircleLockIcon, Pin02Icon } from "@hugeicons/core-free-icons";
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
      {state.isInternal && (
        <Badge variant="info">
          <HugeiconsIcon icon={CircleLockIcon} /> Internal
        </Badge>
      )}
      {state.pinnedAt != null && (
        <Badge
          className="border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
          variant="default"
        >
          <HugeiconsIcon icon={Pin02Icon} />
          Pinned
        </Badge>
      )}
    </div>
  );
}
