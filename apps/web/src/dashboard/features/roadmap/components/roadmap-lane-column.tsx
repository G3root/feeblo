import type { ReactNode, Ref } from "react";
import { cn } from "~/lib/utils";
import { getBoardStatusLabel } from "../../board/constants";
import { RoadmapStatusIcon } from "./roadmap-status-icon";
import type { RoadmapStatus } from "./types";

interface RoadmapLaneColumnProps {
  action?: ReactNode;
  children?: ReactNode;
  contentRef?: Ref<HTMLDivElement>;
  isHighlighted?: boolean;
  status: RoadmapStatus;
  totalPosts: number;
}

export function RoadmapLaneColumn({
  action,
  children,
  contentRef,
  isHighlighted = false,
  status,
  totalPosts,
}: RoadmapLaneColumnProps) {
  const readableStatus = getBoardStatusLabel(status);

  return (
    <div className="flex h-full min-h-0 w-80 flex-col overflow-hidden rounded-lg bg-muted/30">
      <div className="px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <RoadmapStatusIcon status={status} />
            <h3 className="font-medium text-sm">{readableStatus}</h3>
            <span className="text-muted-foreground text-xs">{totalPosts}</span>
          </div>
          {action}
        </div>
      </div>

      <div
        className={cn(
          "flex-1 space-y-2 overflow-y-auto p-3 transition-colors",
          isHighlighted && "bg-muted/50"
        )}
        ref={contentRef}
      >
        {children}
      </div>
    </div>
  );
}
