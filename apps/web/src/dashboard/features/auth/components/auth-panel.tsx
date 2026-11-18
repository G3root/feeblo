import { DEFAULT_POST_STATUS_COLORS } from "@feeblo/domain-contracts/post-status-colors";
import { UserAvatar } from "@feeblo/ui/user-avatar";
import { cn } from "@feeblo/ui/utils";
import { ArrowUp01Icon, Comment01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMachine } from "@xstate/react";
import type { ReactNode } from "react";

import { authPanelSampleVoteMachine } from "../lib/auth-panel-sample-vote-machine";

/**
 * The panel beside the auth form: the product in five tiles.
 *
 * An auth page has one job, so the column beside it is not free real estate for
 * decoration. It shows what the visitor is signing in *to* — a customer's
 * request and the votes that decide what gets built, the roadmap that answers
 * it, the boards it lands on, and the changelog that closes the loop.
 *
 * Five tiles rather than one screenshot because the column is tall and a
 * request page is short: a single window leaves half the panel empty, and
 * filling it with a longer feed invents posts the product does not have. A
 * bento is honest about being a set of surfaces — each tile is one component
 * cropped to what identifies it, at the size the product draws it, and the
 * varied sizes do the work a page's own sections would do.
 *
 * The composition follows the app's own bento rules: one hero (the request,
 * with its vote), neighbours of different kinds (a number beside a lane, a
 * list beside an entry), one accent on the one thing the panel is about, and
 * no string, avatar or status repeated from tile to tile.
 *
 * `aria-hidden`: every word in here is illustrative (a fictional workspace,
 * sample posts, invented counts and commenters), and a screen reader
 * announcing "128 votes, Dark mode for the embeddable widget" would be
 * describing a page that does not exist.
 *
 * Motion: one vote lands on the hero — the affordance a new visitor meets
 * first, previewed doing the thing it does. It then stays still. Nothing
 * loops, because a looping decoration next to a form competes with typing. The
 * sample vote is a machine (`../lib/auth-panel-sample-vote-machine`), not a
 * timer in an effect, so the first client render matches the server's.
 */

/** One tile. Shared radius, gap, padding and surface, as a set must. */
function Tile({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-background border-border/60 flex min-h-0 flex-col overflow-hidden rounded-2xl border p-4",
        className
      )}
    >
      {children}
    </div>
  );
}

/** The label every supporting tile carries, in the product's own casing. */
function TileLabel({ children }: { readonly children: ReactNode }) {
  return (
    <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
      {children}
    </span>
  );
}

function StatusMark({
  type,
  label,
}: {
  readonly label: string;
  readonly type: keyof typeof DEFAULT_POST_STATUS_COLORS;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: DEFAULT_POST_STATUS_COLORS[type] }}
      />
      {label}
    </span>
  );
}

function BoardBadge({ children }: { readonly children: ReactNode }) {
  return (
    <span className="bg-muted/70 text-muted-foreground rounded-full px-2 py-0.5 text-[11px] font-medium">
      {children}
    </span>
  );
}

/**
 * The vote control, drawn to the compact trigger's geometry.
 *
 * Deliberately not the real `UpvoteButton`: that one reads a session, a live
 * query and a TanStack DB collection, none of which exist on a signed-out page.
 * The size, radius and voted palette are the real ones so the panel previews
 * the control honestly instead of approximating it.
 */
function VoteChip({
  count,
  voted,
}: {
  readonly count: number;
  readonly voted: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] leading-none font-medium tabular-nums",
        voted
          ? "border-brand/40 bg-brand/12 text-brand"
          : "border-border text-muted-foreground"
      )}
    >
      <span className="relative flex items-center justify-center">
        {voted ? (
          <span
            aria-hidden
            className="animate-vote-burst border-brand/60 absolute size-4 rounded-full border motion-reduce:hidden"
          />
        ) : null}
        <HugeiconsIcon
          className="size-4 shrink-0"
          icon={ArrowUp01Icon}
          strokeWidth={2.5}
        />
      </span>
      {/* Keyed on the count so the arriving number replays the rise rather
          than swapping in place. */}
      <span className="motion-safe:animate-rise-in leading-none" key={count}>
        {count}
      </span>
    </span>
  );
}

/** The hero: one request, with the vote that decides whether it gets built. */
function RequestTile({ voted }: { readonly voted: boolean }) {
  return (
    <Tile className="border-border/70 flex-[0.95] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_24px_48px_-32px_rgba(0,0,0,0.35)]">
      <div className="flex items-center gap-2">
        <StatusMark label="Planned" type="PLANNED" />
        <BoardBadge>Features</BoardBadge>
      </div>

      <p className="mt-2.5 text-base leading-snug font-semibold tracking-tight text-balance">
        Dark mode for the embeddable widget
      </p>
      <p className="text-muted-foreground mt-1.5 line-clamp-2 text-xs leading-relaxed">
        The board is white at 1am. A dark theme would make the widget match the
        sites it sits on.
      </p>

      <div className="mt-3 flex items-center gap-2.5">
        <VoteChip count={voted ? 129 : 128} voted={voted} />
        <span className="bg-border h-4 w-px shrink-0" />
        <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-[11px]">
          <UserAvatar name="Maya" size="sm" />
          <span className="truncate">Maya</span>
        </span>
        <span className="text-muted-foreground ml-auto flex shrink-0 items-center gap-1 text-[11px] tabular-nums">
          <HugeiconsIcon
            className="size-3.5"
            icon={Comment01Icon}
            strokeWidth={2}
          />
          7
        </span>
      </div>

      {/* The thread under the request: the panel is about what customers want
          and who is answering, and a request with no replies is a wish. */}
      <div className="border-border/50 mt-3 flex flex-col gap-2.5 border-t pt-3">
        <div className="flex items-start gap-2.5">
          <UserAvatar isMember name="Jonas" size="sm" />
          <p className="text-muted-foreground min-w-0 text-[11px] leading-relaxed">
            <span className="text-foreground font-medium">Jonas</span> Moved
            this to Planned — the column updates on its own.
          </p>
        </div>
        <div className="flex items-start gap-2.5">
          <UserAvatar name="Priya" size="sm" />
          <p className="text-muted-foreground min-w-0 text-[11px] leading-relaxed">
            <span className="text-foreground font-medium">Priya</span> Could the
            status change send an email? Half our customers never come back.
          </p>
        </div>
        <div className="flex items-start gap-2.5">
          <UserAvatar name="Dana" size="sm" />
          <p className="text-muted-foreground min-w-0 text-[11px] leading-relaxed">
            <span className="text-foreground font-medium">Dana</span> Same
            request from us — we embed on a black site.
          </p>
        </div>
      </div>
    </Tile>
  );
}

/** A number, its label, and the week it measures. */
function VotesTile() {
  return (
    <Tile>
      <TileLabel>Votes</TileLabel>
      <p className="mt-1.5 text-3xl leading-none font-semibold tracking-tight tabular-nums">
        269
      </p>
      <p className="text-muted-foreground mt-1.5 text-[11px]">
        on the top five requests
      </p>
      {/* The bars fill the rest of the tile: a number at the top of a tall
          tile with a chart pinned under it leaves a void in the middle that
          reads as missing content. */}
      <div className="mt-3 flex min-h-0 flex-1 items-end gap-1">
        {[38, 52, 30, 64, 44, 58, 72].map((height, index) => (
          <span
            className={cn(
              "flex-1 rounded-sm",
              index === 6 ? "bg-brand/60" : "bg-brand/20"
            )}
            key={height}
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
    </Tile>
  );
}

/** A roadmap lane, which is a status and the posts it holds. */
function LaneTile() {
  return (
    <Tile className="bg-muted/40">
      <div className="flex items-center justify-between gap-2">
        <StatusMark label="In progress" type="IN_PROGRESS" />
        <span className="text-muted-foreground text-[11px] tabular-nums">
          4
        </span>
      </div>

      <div className="mt-2.5 flex flex-col gap-2">
        <div className="bg-background flex flex-col gap-1.5 rounded-lg border p-2.5">
          <p className="line-clamp-2 text-[11px] leading-snug font-medium">
            Keyboard shortcuts on the board
          </p>
          <span className="text-muted-foreground flex items-center gap-1 text-[10px] tabular-nums">
            <HugeiconsIcon
              className="size-3 shrink-0"
              icon={ArrowUp01Icon}
              strokeWidth={2.5}
            />
            64
          </span>
        </div>
        <div className="bg-background flex flex-col gap-1.5 rounded-lg border p-2.5">
          <p className="line-clamp-2 text-[11px] leading-snug font-medium">
            Widget launcher overlaps the home bar
          </p>
          <span className="text-muted-foreground flex items-center gap-1 text-[10px] tabular-nums">
            <HugeiconsIcon
              className="size-3 shrink-0"
              icon={ArrowUp01Icon}
              strokeWidth={2.5}
            />
            7
          </span>
        </div>
        <div className="bg-background flex flex-col gap-1.5 rounded-lg border p-2.5">
          <p className="line-clamp-2 text-[11px] leading-snug font-medium">
            Export a board to CSV
          </p>
          <span className="text-muted-foreground flex items-center gap-1 text-[10px] tabular-nums">
            <HugeiconsIcon
              className="size-3 shrink-0"
              icon={ArrowUp01Icon}
              strokeWidth={2.5}
            />
            12
          </span>
        </div>
        <div className="bg-background flex flex-col gap-1.5 rounded-lg border p-2.5">
          <p className="line-clamp-2 text-[11px] leading-snug font-medium">
            Custom tags on posts
          </p>
          <span className="text-muted-foreground flex items-center gap-1 text-[10px] tabular-nums">
            <HugeiconsIcon
              className="size-3 shrink-0"
              icon={ArrowUp01Icon}
              strokeWidth={2.5}
            />
            5
          </span>
        </div>
      </div>
    </Tile>
  );
}

/**
 * The changelog entry, as the changelog lists it: what shipped, when, and who
 * was told. A wide strip rather than a square: the set ends on something calm
 * after two dense rows, and a strip lets the meta sit on the row instead of in
 * a column under it.
 */
function ChangelogTile() {
  return (
    <Tile className="justify-center">
      <div className="flex items-center gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <StatusMark label="Completed" type="COMPLETED" />
            <span className="text-muted-foreground text-[10px]">2d</span>
          </div>
          <p className="truncate text-xs font-medium">
            Custom tags, and a faster board
          </p>
        </div>
        <p className="text-muted-foreground ml-auto hidden shrink-0 text-[10px] leading-relaxed sm:block">
          Published to the changelog. 340 people were emailed.
        </p>
      </div>
    </Tile>
  );
}

export function AuthPanel({ className }: { readonly className?: string }) {
  // `settling` on the server and on the first client render — the actor starts
  // in an effect — so hydration compares two identical documents and the vote
  // lands one state later.
  const [sampleVote] = useMachine(authPanelSampleVoteMachine);

  const hasVoted = sampleVote.matches("voted");

  return (
    <aside
      aria-hidden
      className={cn(
        // A recessed ground in both themes: on dark, `bg-muted` is *lighter*
        // than the tiles it frames, which would sink the product into the page.
        // Depth on dark comes from a darker ground, not a shadow.
        "bg-muted/40 relative hidden overflow-hidden lg:block dark:bg-black/30",
        className
      )}
      data-slot="auth-panel"
    >
      {/* One even gutter round the set: the tiles are the picture, and a grid
          pressed against its frame reads as a screenshot rather than a
          composition. The gap equals the tiles' own padding. */}
      <div className="absolute inset-8 flex flex-col gap-4">
        <RequestTile voted={hasVoted} />

        <div className="flex min-h-0 flex-[1.05] gap-4">
          <VotesTile />
          <LaneTile />
        </div>

        <div className="flex min-h-0 flex-[0.4] gap-4">
          <ChangelogTile />
        </div>
      </div>
    </aside>
  );
}
