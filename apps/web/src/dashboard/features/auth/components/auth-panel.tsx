import { DEFAULT_POST_STATUS_COLORS } from "@feeblo/domain-contracts/post-status-colors";
import { cn } from "@feeblo/ui/utils";
import { ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";

/**
 * The panel beside the auth form: a slice of the product, rendered in the DOM
 * rather than shipped as an image.
 *
 * An auth page has one job, so the column beside it is not free real estate for
 * decoration. It shows the thing the visitor is signing in *to* — a board of
 * requests with the vote counts that decide what gets built — at a scale where
 * the vote is legible. That also lets the page preview the vote control the
 * product uses, which is the one affordance a new visitor will meet first.
 *
 * `aria-hidden`: every word in here is illustrative (a fictional board, sample
 * posts, invented counts), and a screen reader announcing "128 votes, Dark mode
 * for the embeddable widget" would be describing a page that does not exist.
 *
 * Motion: one orchestrated entrance — the frame settles, the three rows arrive
 * 90ms apart, and a vote lands on the first row. It then stays still. Nothing
 * here loops, because a looping decoration next to a form competes with typing.
 * Under `prefers-reduced-motion` the whole sequence is skipped and the board
 * renders in its resting state.
 */

const samplePosts = [
  {
    author: "Maya",
    statusLabel: "Planned",
    statusType: "PLANNED",
    title: "Dark mode for the embeddable widget",
    votes: 128,
  },
  {
    author: "Jonas",
    statusLabel: "In Progress",
    statusType: "IN_PROGRESS",
    title: "Keyboard shortcuts on the board",
    votes: 64,
  },
  {
    author: "Priya",
    statusLabel: "Pending",
    statusType: "PENDING",
    title: "Export a board to CSV",
    votes: 12,
  },
  {
    author: "Tom",
    statusLabel: "Completed",
    statusType: "COMPLETED",
    title: "Slack notifications for new posts",
    votes: 9,
  },
] as const;

const voteLandingDelayMs = 1500;

export function AuthPanel({ className }: { className?: string }) {
  // The count the board shows before anyone presses anything, and whether the
  // sample vote has landed yet. `false` on the server and on the first client
  // render, so hydration compares two identical documents.
  const [hasVoted, setHasVoted] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setHasVoted(true);
    }, voteLandingDelayMs);

    return () => {
      window.clearTimeout(timeout);
    };
  }, []);

  return (
    <aside
      aria-hidden
      className={cn(
        "bg-muted/40 border-border relative hidden overflow-hidden border-l lg:block",
        className
      )}
      data-slot="auth-panel"
    >
      {/* One soft light source behind the board. Not a gradient wash: the
          panel needs a direction for the card's shadow to read against. */}
      <div className="bg-brand/6 pointer-events-none absolute -top-24 -right-20 size-[26rem] rounded-full blur-3xl" />

      <div className="relative flex h-full items-center justify-center px-12 py-16 xl:px-20">
        <div className="w-full max-w-[30rem]">
          <div className="motion-safe:animate-board-in border-border bg-card overflow-hidden rounded-2xl border shadow-sm">
            <div className="border-border flex items-center justify-between gap-3 border-b px-5 py-3.5">
              <span className="text-foreground inline-flex items-center gap-2 text-sm font-medium">
                <span className="bg-brand size-1.5 rounded-full" />
                Product feedback
              </span>
            </div>

            <ul className="divide-border divide-y">
              {samplePosts.map((post, index) => (
                <li
                  className="motion-safe:animate-board-in flex items-start gap-3.5 px-5 py-4"
                  key={post.title}
                  style={{
                    animationDelay: `${140 + index * 90}ms`,
                  }}
                >
                  <PanelVote
                    count={
                      index === 0 && hasVoted ? post.votes + 1 : post.votes
                    }
                    isVoted={index === 0 && hasVoted}
                  />
                  <div className="min-w-0 flex-1 pt-1">
                    <p className="text-foreground truncate text-sm leading-snug font-medium">
                      {post.title}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
                        <span
                          className="size-1.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              DEFAULT_POST_STATUS_COLORS[post.statusType],
                          }}
                        />
                        {post.statusLabel}
                      </span>
                      <span className="text-muted-foreground truncate text-xs">
                        {post.author}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-muted-foreground mt-8 max-w-[26rem] text-sm leading-relaxed">
            What your customers want, and how many of them want it.
          </p>
        </div>
      </div>
    </aside>
  );
}

/**
 * A still copy of the compact vote control from `@feeblo/post-ui/upvote-toggle`.
 *
 * Deliberately not the real component: that one reads a session, a live query
 * and a TanStack DB collection, none of which exist on a signed-out page. The
 * dimensions and the voted palette are kept identical so the panel previews
 * the control honestly instead of approximating it.
 */
function PanelVote({ count, isVoted }: { count: number; isVoted: boolean }) {
  return (
    <span
      className={cn(
        "pointer-events-none relative flex h-11 w-10 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border transition-colors duration-300 ease-out",
        isVoted
          ? "border-brand/40 bg-brand/12 text-brand"
          : "border-border bg-muted/50 text-muted-foreground"
      )}
    >
      {isVoted ? (
        <span className="animate-vote-burst border-brand/60 absolute top-2 left-1/2 size-4 -translate-x-1/2 rounded-full border" />
      ) : null}
      <HugeiconsIcon
        className="size-3.5"
        icon={ArrowUp01Icon}
        strokeWidth={2.5}
      />
      {/* Keyed on the count so the arriving number replays the rise rather
          than swapping in place. `@number-flow/react` would be the better
          tool, but it is a `post-ui` dependency and adding it here for one
          decorative figure is not worth the install. */}
      <span
        className="motion-safe:animate-rise-in text-[11px] leading-none font-medium tabular-nums"
        key={count}
      >
        {count}
      </span>
    </span>
  );
}
