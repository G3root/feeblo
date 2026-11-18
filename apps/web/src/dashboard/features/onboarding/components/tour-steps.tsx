import { cn } from "@feeblo/ui/utils";
import {
  ArrowUp02Icon,
  DashboardSquare01Icon,
  Megaphone01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type React from "react";

/**
 * The tour's copy, one entry per surface a new workspace has.
 *
 * The `detail` of a step is the point of the whole design. It is one row from
 * the product, drawn with the same parts the reader is about to see on their
 * own board, so the step they read is recognisable on the screen behind it. An
 * illustration of a feature teaches nothing; the row teaches the shape.
 *
 * Every step names something this workspace actually has: the boards and
 * six statuses `createWorkspace` writes, the roadmap columns, the changelog
 * categories, the widget, the Public API. The three posts the rows name are
 * the ones the seed puts on the board, so a reader who follows the tour sees
 * the same titles when they open it.
 *
 * Rows are static. They are a picture of the shape of the product, not a
 * preview of this workspace's data, and a live query behind a five-step dialog
 * would spend requests to show numbers nobody acts on.
 */

export type WelcomeTourStep = {
  readonly description: React.ReactNode;
  readonly detail: React.ReactNode;
  readonly id: string;
  readonly title: string;
};

/** The vote pill every post row carries on the board. */
function VotePill({ votes }: { readonly votes: number }) {
  return (
    <span className="text-muted-foreground flex w-9 shrink-0 flex-col items-center rounded-md border py-1 text-[11px] font-medium tabular-nums">
      <HugeiconsIcon className="size-3.5" icon={ArrowUp02Icon} />
      {votes}
    </span>
  );
}

/** The row every step's plate shows, in the board's own proportions. */
function PreviewRow({
  children,
  icon,
  iconClassName,
  subtitle,
  title,
  votes,
}: {
  readonly children?: React.ReactNode;
  readonly icon?: React.ReactNode;
  readonly iconClassName?: string;
  readonly subtitle: React.ReactNode;
  readonly title: string;
  readonly votes?: number;
}) {
  return (
    <div className="bg-background flex w-[min(100%,20rem)] items-center gap-3 rounded-xl px-3.5 py-3 text-left text-sm shadow-[0_1px_2px_rgba(0,0,0,0.08),0_12px_24px_-16px_rgba(0,0,0,0.4)]">
      {votes === undefined ? (
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md",
            iconClassName
          )}
        >
          {icon}
        </span>
      ) : (
        <VotePill votes={votes} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        <span className="text-muted-foreground mt-0.5 block truncate text-xs">
          {subtitle}
        </span>
      </span>
      {children}
    </div>
  );
}

/**
 * A status dot in the colour the status actually has.
 *
 * The six defaults come from `DEFAULT_POST_STATUS_COLORS`, and a dot in the
 * wrong hue is a small lie about a colour the reader will see within seconds.
 */
function StatusDot({
  className,
  children,
}: {
  readonly children: React.ReactNode;
  readonly className: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn("size-1.5 rounded-full", className)} />
      {children}
    </span>
  );
}

/**
 * Builds the five steps.
 *
 * `boardUrl` is null until the workspace's site row resolves, and the last
 * step says that the board is public without printing a half-built address:
 * a preview of the wrong URL is worse than a sentence that waits for the right
 * one.
 */
export function buildWelcomeTourSteps({
  workspaceName,
  boardUrl,
}: {
  readonly boardUrl: string | null;
  readonly workspaceName: string;
}): WelcomeTourStep[] {
  const boardHost = boardUrl?.replace(/^https?:\/\//, "") ?? null;

  return [
    {
      id: "welcome",
      title: `Welcome to ${workspaceName}`,
      description: (
        <>
          Your workspace has boards, a roadmap, a changelog and a help center.
          We added three posts so you can see how they fit together. Edit or
          delete them whenever you like.
        </>
      ),
      detail: (
        <PreviewRow
          subtitle={
            <StatusDot className="bg-muted-foreground/60">Pending</StatusDot>
          }
          title="Welcome to your workspace"
          votes={0}
        />
      ),
    },
    {
      id: "boards",
      title: "Boards hold the posts",
      description: (
        <>
          A post belongs to one board and carries one status. New posts land in{" "}
          <span className="text-foreground font-medium">Pending</span>. Move it
          through Review, Planned, In Progress and Completed as you triage, and
          assign whoever is doing the work.
        </>
      ),
      detail: (
        <PreviewRow
          subtitle={
            <StatusDot className="bg-muted-foreground/60">Pending</StatusDot>
          }
          title="What makes a bug report useful"
          votes={0}
        />
      ),
    },
    {
      id: "roadmap",
      title: "The roadmap reads status",
      description: (
        <>
          Your roadmap has columns for Planned, In progress and Completed. A
          post appears in a column because of its status, so the status is the
          only place you update.
        </>
      ),
      detail: (
        <PreviewRow
          icon={
            <HugeiconsIcon
              className="text-muted-foreground size-4"
              icon={DashboardSquare01Icon}
            />
          }
          iconClassName="border"
          subtitle={
            <StatusDot className="bg-indigo-500">Planned · Features</StatusDot>
          }
          title="How ideas become roadmap items"
        />
      ),
    },
    {
      id: "changelog",
      title: "The changelog closes the loop",
      description: (
        <>
          Publish an entry when work ships. People who subscribed to the post or
          to the changelog get an email, and the entry is public.
        </>
      ),
      detail: (
        <PreviewRow
          icon={
            <HugeiconsIcon
              className="size-4 text-emerald-600"
              icon={Megaphone01Icon}
            />
          }
          iconClassName="bg-emerald-500/10"
          subtitle="New · Draft"
          title="Sample posts are ready to edit"
        />
      ),
    },
    {
      id: "board",
      title: "Your board is public",
      description: boardHost ? (
        <>
          Anyone can read it at{" "}
          <span className="text-foreground font-medium">{boardHost}</span>. The
          same posts are available as a widget you can embed on your own site,
          and the Public API serves them to anything else.
        </>
      ) : (
        <>
          Your public board is the page your customers read. The same posts are
          available as a widget you can embed on your own site, and the Public
          API serves them to anything else.
        </>
      ),
      detail: (
        <PreviewRow
          icon={
            <HugeiconsIcon
              className="size-4 text-emerald-600"
              icon={Megaphone01Icon}
            />
          }
          iconClassName="bg-emerald-500/10"
          subtitle={boardHost ? "Live" : "Setting up"}
          title={boardHost ?? "Your public board"}
        >
          <span className="relative flex size-2 shrink-0">
            <span
              aria-hidden
              className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60"
            />
            <span className="relative size-2 rounded-full bg-emerald-500" />
          </span>
        </PreviewRow>
      ),
    },
  ];
}
