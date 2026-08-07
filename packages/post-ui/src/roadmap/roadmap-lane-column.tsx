import { ScrollArea } from "@feeblo/ui/scroll-area";
import { cn } from "@feeblo/ui/utils";
import { getBoardStatusLabel } from "@feeblo/web-shared/board/constants";
import type { ReactNode, Ref } from "react";
import { RoadmapStatusIcon } from "./roadmap-status-icon";
import type { RoadmapStatus } from "./types";

interface RoadmapLaneColumnProps {
  action?: ReactNode;
  children?: ReactNode;
  contentRef?: Ref<HTMLDivElement>;
  isHighlighted?: boolean;
  name?: string;
  status: RoadmapStatus;
  totalPosts: number;
}

export function RoadmapLaneColumn({
  action,
  children,
  contentRef,
  isHighlighted = false,
  name,
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
            <h3 className="font-medium text-sm">{name ?? readableStatus}</h3>
            <span className="text-muted-foreground text-xs">{totalPosts}</span>
          </div>
          {action}
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
