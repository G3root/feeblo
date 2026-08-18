import { Badge } from "@feeblo/ui/badge";
import { CircleLockIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useCommentDisplay } from "./context";
import { formatRelativeTime } from "./utils";

export function CommentDisplayHeader() {
  const { state } = useCommentDisplay();

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium">{state.authorName}</span>
      <span className="text-muted-foreground text-xs">
        {formatRelativeTime(state.createdAt)}
      </span>
      {state.isInternal && (
        <Badge variant="info">
          <HugeiconsIcon icon={CircleLockIcon} /> Internal
        </Badge>
      )}
    </div>
  );
}
