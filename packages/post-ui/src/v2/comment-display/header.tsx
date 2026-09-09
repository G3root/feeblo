import { Badge } from "@feeblo/ui/badge";
import { formatPostStatus } from "@feeblo/web-shared/board/constants";
import { CircleLockIcon, Pin02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { m } from "../../paraglide/messages.js";
import { useCommentDisplay } from "./context";
import { formatRelativeTime } from "./utils";

export function CommentDisplayHeader() {
  const { state } = useCommentDisplay();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">{state.authorName}</span>

      {state.statusUpdateType != null && (
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          {m.gray_lower_tadpole()}{" "}
          {state.statusUpdateLabel || formatPostStatus(state.statusUpdateType)}
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full"
            style={
              state.statusUpdateColor
                ? { backgroundColor: state.statusUpdateColor }
                : undefined
            }
          />
        </span>
      )}
      <span className="text-muted-foreground text-xs">
        {formatRelativeTime(state.createdAt)}
      </span>
      {state.isInternal && (
        <Badge variant="info">
          <HugeiconsIcon icon={CircleLockIcon} /> {m.quaint_slimy_osprey()}
        </Badge>
      )}
      {state.pinnedAt != null && (
        <Badge
          className="border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
          variant="default"
        >
          <HugeiconsIcon icon={Pin02Icon} />
          {m.main_drab_maggot()}
        </Badge>
      )}
    </div>
  );
}
