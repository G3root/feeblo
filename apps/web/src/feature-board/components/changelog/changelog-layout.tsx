import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "~/lib/utils";
import {
  FeedbackBrowseLayout,
  FeedbackBrowseLayoutContent,
  FeedbackBrowseLayoutMain,
} from "../layout/feedback-browse-layout";

export function ChangelogPageLayout({ children }: { children: ReactNode }) {
  return (
    <FeedbackBrowseLayout>
      <FeedbackBrowseLayoutContent fullWidth>
        <FeedbackBrowseLayoutMain>{children}</FeedbackBrowseLayoutMain>
      </FeedbackBrowseLayoutContent>
    </FeedbackBrowseLayout>
  );
}

export function ChangelogTimeline({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="absolute top-0 left-3 hidden h-full w-px bg-border/60 md:block"
      />
      {children}
    </div>
  );
}

export function ChangelogTimelineItem({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <article
      className={cn(
        "grid gap-6 md:grid-cols-[11rem_minmax(0,1fr)] md:items-start md:gap-10",
        className
      )}
      {...props}
    >
      {children}
    </article>
  );
}

export function ChangelogTimelineDate({ children }: { children: ReactNode }) {
  return (
    <div className="relative md:self-start">
      <div className="relative flex items-center gap-3 md:sticky md:top-24 md:pl-8">
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-3 hidden size-2.5 -translate-x-1/2 -translate-y-1/2 md:block"
        >
          <span className="absolute inset-0 size-2.5 animate-ping rounded-full bg-foreground/35" />
          <span className="relative block size-2.5 rounded-full bg-foreground" />
        </span>
        {children}
      </div>
    </div>
  );
}

export function ChangelogStickyRail({ children }: { children: ReactNode }) {
  return (
    <div className="relative md:self-start">
      <div className="relative md:sticky md:top-24">{children}</div>
    </div>
  );
}

export function ChangelogTimelineBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("min-w-0", className)}>{children}</div>;
}

export function formatChangelogDate(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}
