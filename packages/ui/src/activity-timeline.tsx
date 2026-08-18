import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { ReactNode } from "react";

import { cn } from "./utils";

/**
 * Minimal vertical timeline for activity feeds.
 *
 * A stripped-down timeline for activity feeds: no active-step state, no
 * orientation, no absolute positioning. Each item is a flex row — a plain
 * icon rail on the left (no background circle) with a hairline (`w-0.5`)
 * separator, and content on the right. The separator is hidden on the last
 * item.
 */

function ActivityTimeline({
  className,
  render,
  children,
  ...props
}: useRender.ComponentProps<"ul">) {
  const defaultProps = {
    className: cn("flex flex-col", className),
    "data-slot": "activity-timeline",
    children,
  };

  return useRender({
    defaultTagName: "ul",
    render,
    props: mergeProps<"ul">(defaultProps, props),
  });
}

interface ActivityTimelineItemProps extends useRender.ComponentProps<"li"> {
  /** Leading icon, rendered plain at the top of the rail. */
  icon?: ReactNode;
}

function ActivityTimelineItem({
  icon,
  className,
  render,
  children,
  ...props
}: ActivityTimelineItemProps) {
  const defaultProps = {
    className: cn(
      "group/activity-timeline-item flex gap-3 not-last:pb-5",
      className
    ),
    "data-slot": "activity-timeline-item",
    children: (
      <>
        <div
          aria-hidden="true"
          className="flex shrink-0 flex-col items-center"
          data-slot="activity-timeline-indicator"
        >
          <div className="mt-px flex size-3.5 items-center justify-center">
            {icon}
          </div>
          <div
            className="bg-border w-0.5 flex-1 group-last/activity-timeline-item:hidden"
            data-slot="activity-timeline-separator"
          />
        </div>
        <div
          className="text-muted-foreground min-w-0 flex-1 text-xs leading-[1.4]"
          data-slot="activity-timeline-content"
        >
          {children}
        </div>
      </>
    ),
  };

  return useRender({
    defaultTagName: "li",
    render,
    props: mergeProps<"li">(defaultProps, props),
  });
}

export { ActivityTimeline, ActivityTimelineItem };
