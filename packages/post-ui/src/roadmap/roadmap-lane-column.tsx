import { ScrollArea } from "@feeblo/ui/scroll-area";
import { cn } from "@feeblo/ui/utils";
import { formatPostStatus } from "@feeblo/web-shared/board/constants";
import type { ReactNode, Ref } from "react";

import { RoadmapStatusIcon } from "./roadmap-status-icon";
import type { RoadmapStatus } from "./types";

interface RoadmapLaneColumnProps {
  action?: ReactNode;
  children?: ReactNode;
  contentRef?: Ref<HTMLDivElement>;
  isHighlighted?: boolean;
  label?: string;
  name?: string;
  status: RoadmapStatus;
  totalPosts?: number;
}

export function RoadmapLaneColumn({
  action,
  children,
  contentRef,
  isHighlighted = false,
  label,
  name,
  status,
  totalPosts,
}: RoadmapLaneColumnProps) {
  const readableStatus = name ?? label ?? formatPostStatus(status);
  const resolvedAction =
    action ??
    (totalPosts !== undefined ? (
      <span className="text-muted-foreground text-xs tabular-nums">
        {totalPosts}
      </span>
    ) : undefined);

  return (
    <div className="bg-muted/30 flex h-full min-h-0 w-80 flex-col overflow-hidden rounded-lg">
      <div className="px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <RoadmapStatusIcon status={status} />
            <h3 className="text-sm font-medium">{readableStatus}</h3>
          </div>
          {resolvedAction}
        </div>
      </div>

      <ScrollArea
        className={cn(
          "min-h-0 flex-1 transition-colors",
          isHighlighted && "bg-muted/50"
        )}
        viewportRef={contentRef}
      >
        <div className="space-y-2 p-3">{children}</div>
      </ScrollArea>
    </div>
  );
}
