import { DEFAULT_POST_STATUS_COLORS } from "@feeblo/domain-contracts/post-status-colors";
import { UserAvatar } from "@feeblo/ui/user-avatar";
import { cn } from "@feeblo/ui/utils";
import {
  ArrowUp01Icon,
  Comment01Icon,
  LockIcon,
  Megaphone01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type React from "react";

/**
 * The tour's copy, one entry per surface a new workspace has.
 *
 * The `detail` of a step is the point of the whole design: one object from the
 * product, drawn at the size the product draws it — a post, a board list, a
 * roadmap lane, a changelog entry, the board's own address. A step the reader
 * reads is then recognisable on the screen behind the dialog, because it is
 * the same row, lane or card rather than an illustration of one.
 *
 * One object, not a shrunken page: the plate is 176px tall and the dialog is
 * 28rem wide, and a whole window at that size is a thumbnail where nothing is
 * legible. A single object at full size can be read from across the room.
 *
 * Every step names something this workspace actually has: the boards the
 * reader kept, the statuses `createWorkspace` writes, the changelog
 * categories, the Public API, the board address. The sample post titles are
 * the ones the seed writes, so a reader who follows the tour meets the same
 * rows when they close it.
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

/** The card every detail sits in: one product object, lifted off the plate. */
function PlateCard({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-background border-border/70 w-[min(100%,21rem)] rounded-xl border px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_16px_32px_-24px_rgba(0,0,0,0.45)]",
        className
      )}
    >
      {children}
    </div>
  );
}

/** The vote pill every post row carries on the board, at its real size. */
function VotePill({
  count,
  voted = false,
}: {
  readonly count: number;
  readonly voted?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex h-11 w-10 shrink-0 flex-col items-center justify-center rounded-lg border text-[11px] leading-none font-medium tabular-nums",
        voted
          ? "border-brand/40 bg-brand/12 text-brand"
          : "border-border bg-muted/50 text-muted-foreground"
      )}
    >
      <HugeiconsIcon
        className="size-4 shrink-0"
        icon={ArrowUp01Icon}
        strokeWidth={2.5}
      />
      {count}
    </span>
  );
}

/**
 * A status in the colour the status actually has.
 *
 * The six defaults come from `DEFAULT_POST_STATUS_COLORS`, and a dot in the
 * wrong hue is a small lie about a colour the reader will see within seconds.
 */
function StatusMark({
  label,
  type,
}: {
  readonly label: string;
  readonly type: keyof typeof DEFAULT_POST_STATUS_COLORS;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: DEFAULT_POST_STATUS_COLORS[type] }}
      />
      {label}
    </span>
  );
}

function BoardBadge({ children }: { readonly children: React.ReactNode }) {
  return (
    <span className="bg-muted/70 text-muted-foreground rounded-full px-2 py-0.5 text-[11px] font-medium">
      {children}
    </span>
  );
}

/** One board's row, as the board list shows it: a post and what it carries. */
function SamplePost({
  board,
  status,
  title,
  votes,
}: {
  readonly board: string;
  readonly status: {
    label: string;
    type: keyof typeof DEFAULT_POST_STATUS_COLORS;
  };
  readonly title: string;
  readonly votes: number;
}) {
  return (
    <PlateCard>
      <div className="flex items-center gap-3">
        <VotePill count={votes} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{title}</p>
          <div className="text-muted-foreground mt-1.5 flex items-center gap-2 text-xs">
            <StatusMark label={status.label} type={status.type} />
            <BoardBadge>{board}</BoardBadge>
          </div>
        </div>
      </div>
    </PlateCard>
  );
}

/** The board list, as the public board's sidebar draws it. */
function BoardList({ boards }: { readonly boards: readonly string[] }) {
  return (
    <PlateCard className="w-[min(100%,15rem)]">
      <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
        Boards
      </span>
      <div className="mt-2 flex flex-col gap-0.5">
        <span className="text-muted-foreground flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
          <span className="bg-muted-foreground/40 size-1.5 shrink-0 rounded-full" />
          All feedback
        </span>
        {boards.map((board, index) => (
          <span
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
              index === 0
                ? "bg-muted text-foreground font-medium"
                : "text-muted-foreground"
            )}
            key={board}
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                index === 0 ? "bg-primary" : "bg-muted-foreground/40"
              )}
            />
            <span className="truncate">{board}</span>
          </span>
        ))}
      </div>
    </PlateCard>
  );
}

/** A roadmap lane with one card in it, the way a status puts it there. */
function RoadmapLane({
  status,
  title,
}: {
  readonly status: {
    label: string;
    type: keyof typeof DEFAULT_POST_STATUS_COLORS;
  };
  readonly title: string;
}) {
  return (
    <div className="bg-muted/40 w-[min(100%,15rem)] rounded-xl p-2.5">
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <span className="flex items-center gap-2 text-xs font-medium">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: DEFAULT_POST_STATUS_COLORS[status.type] }}
          />
          {status.label}
        </span>
        <span className="text-muted-foreground text-[11px] tabular-nums">
          1
        </span>
      </div>
      <div className="bg-background flex flex-col gap-2 rounded-lg border p-2.5">
        <p className="line-clamp-2 text-xs leading-snug font-medium">{title}</p>
        <div className="text-muted-foreground flex items-center justify-between gap-2 text-[11px]">
          <BoardBadge>Features</BoardBadge>
          <span className="flex items-center gap-1 tabular-nums">
            <HugeiconsIcon
              className="size-3 shrink-0"
              icon={ArrowUp01Icon}
              strokeWidth={2.5}
            />
            12
          </span>
        </div>
      </div>
    </div>
  );
}

/** A changelog entry as the changelog lists it: category, title, when. */
function ChangelogEntry({ title }: { readonly title: string }) {
  return (
    <PlateCard>
      <div className="flex items-center gap-2">
        <HugeiconsIcon
          className="size-3.5 shrink-0 text-emerald-600"
          icon={Megaphone01Icon}
          strokeWidth={2}
        />
        <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
          Update
        </span>
      </div>
      <p className="mt-2 text-sm leading-snug font-medium">{title}</p>
      <p className="text-muted-foreground mt-1.5 text-[11px]">
        Published 2 days ago · subscribers were emailed
      </p>
    </PlateCard>
  );
}

/** The board's own address, which is the one thing a visitor needs. */
function BoardAddress({
  host,
  name,
}: {
  readonly host: string | null;
  readonly name: string;
}) {
  return (
    <PlateCard className="w-[min(100%,18rem)]">
      <div className="flex items-center gap-2.5">
        <UserAvatar name={name} size="sm" />
        <span className="min-w-0 truncate text-sm font-medium">{name}</span>
        <span className="border-border text-muted-foreground ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium">
          Public
        </span>
      </div>
      <div className="border-border/70 bg-muted/40 text-muted-foreground mt-2.5 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px]">
        <HugeiconsIcon
          aria-hidden
          className="size-2.5 shrink-0 opacity-70"
          icon={LockIcon}
          strokeWidth={2}
        />
        <span className="truncate">{host ?? "Setting up…"}</span>
      </div>
    </PlateCard>
  );
}

/**
 * Builds the five steps.
 *
 * `boardUrl` is null until the workspace's site row resolves, and the last
 * step says that the board is public without printing a half-built address:
 * a preview of the wrong URL is worse than a sentence that waits for the right
 * one. The plate says "Setting up…" for the same reason, in the same place the
 * address will appear.
 *
 * `boardNames` is the two boards `createWorkspace` writes, renamed by the
 * reader on the register page. The tour names them because the reader named
 * them.
 */
export function buildWelcomeTourSteps({
  boardNames,
  boardUrl,
  workspaceName,
}: {
  readonly boardNames: readonly string[];
  readonly boardUrl: string | null;
  readonly workspaceName: string;
}): WelcomeTourStep[] {
  const boardHost = boardUrl?.replace(/^https?:\/\//, "") ?? null;
  const firstBoard = boardNames[0] ?? "Features";

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
        <SamplePost
          board={firstBoard}
          status={{ label: "Pending", type: "PENDING" }}
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
      detail: <BoardList boards={boardNames} />,
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
        <RoadmapLane
          status={{ label: "Planned", type: "PLANNED" }}
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
      detail: <ChangelogEntry title="Sample posts are ready to edit" />,
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
      detail: <BoardAddress host={boardHost} name={workspaceName} />,
    },
  ];
}
