import type { MouseEventHandler, ReactNode } from "react";
import { cn } from "~/lib/utils";
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
        <span className="line-clamp-2 text-muted-foreground text-xs uppercase tracking-wide">
          {title}
        </span>
        <div className="flex items-start">
          <RoadmapStatusIcon status={status} />
        </div>
      </div>

      {boardName ? (
        <div className="mt-3">
          <span className="rounded-full bg-muted/70 px-2 py-0.5 font-medium text-[11px] text-muted-foreground">
            {boardName}
          </span>
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2 text-muted-foreground text-xs">
        <span>{formatRoadmapPostDate(updatedAt)}</span>
        {footer}
      </div>
    </>
  );
}

function getRoadmapIssueCardClassName(isDragging: boolean) {
  return cn(
    "block w-full rounded-md bg-background p-3 text-left transition-all hover:border-muted-foreground/40 hover:bg-muted/20",
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
  onClick?: MouseEventHandler<HTMLDivElement>;
  rootRef?: (element: HTMLDivElement | null) => void;
};

export function SortableRoadmapIssueCard({
  isDragging = false,
  onClick,
  rootRef,
  ...contentProps
}: SortableRoadmapIssueCardProps) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: sortable card mirrors existing board interaction model
    // biome-ignore lint/a11y/noStaticElementInteractions: sortable card mirrors existing board interaction model
    // biome-ignore lint/a11y/useKeyWithClickEvents: sortable card mirrors existing board interaction model
    <div
      className={getRoadmapIssueCardClassName(isDragging)}
      onClick={onClick}
      ref={rootRef}
    >
      <RoadmapIssueCardContent {...contentProps} />
    </div>
  );
}
