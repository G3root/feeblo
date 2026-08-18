import { cn } from "@feeblo/ui/utils";
import type { MouseEventHandler, ReactNode } from "react";

import { RoadmapStatusIcon } from "./roadmap-status-icon";
import type { RoadmapStatus } from "./types";
import { formatRoadmapPostDate } from "./utils";

type RoadmapIssueCardContentProps = {
  boardName?: string;
  footer?: ReactNode;
  status: RoadmapStatus;
  title: string;
  updatedAt: Date | string;
};

function RoadmapIssueCardContent({
  boardName,
  footer,
  status,
  title,
  updatedAt,
}: RoadmapIssueCardContentProps) {
  return (
    <>
      <div className="flex justify-between gap-2">
        <span className="text-muted-foreground line-clamp-2 text-xs tracking-wide uppercase">
          {title}
        </span>
        <div className="flex items-start">
          <RoadmapStatusIcon status={status} />
        </div>
      </div>

      {boardName ? (
        <div className="mt-3">
          <span className="bg-muted/70 text-muted-foreground rounded-full px-2 py-0.5 text-[11px] font-medium">
            {boardName}
          </span>
        </div>
      ) : null}

      <div className="text-muted-foreground mt-3 flex items-center justify-between gap-2 text-xs">
        <span>{formatRoadmapPostDate(updatedAt)}</span>
        {footer}
      </div>
    </>
  );
}

function getRoadmapIssueCardClassName(isDragging: boolean) {
  return cn(
    "bg-background hover:border-muted-foreground/40 hover:bg-muted/20 block w-full rounded-md p-3 text-left transition-all",
    isDragging && "opacity-60"
  );
}

type PublicRoadmapIssueCardProps = RoadmapIssueCardContentProps & {
  onClick?: MouseEventHandler<HTMLButtonElement>;
};

export function PublicRoadmapIssueCard({
  onClick,
  ...contentProps
}: PublicRoadmapIssueCardProps) {
  return (
    <button
      className={getRoadmapIssueCardClassName(false)}
      onClick={onClick}
      type="button"
    >
      <RoadmapIssueCardContent {...contentProps} />
    </button>
  );
}

type SortableRoadmapIssueCardProps = RoadmapIssueCardContentProps & {
  isDragging?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  rootRef?: (element: HTMLButtonElement | null) => void;
};

export function SortableRoadmapIssueCard({
  isDragging = false,
  onClick,
  rootRef,
  ...contentProps
}: SortableRoadmapIssueCardProps) {
  return (
    <button
      className={getRoadmapIssueCardClassName(isDragging)}
      onClick={onClick}
      ref={rootRef}
      type="button"
    >
      <RoadmapIssueCardContent {...contentProps} />
    </button>
  );
}
