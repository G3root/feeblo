import { UserAvatar } from "@feeblo/ui/user-avatar";
import { cn } from "@feeblo/ui/utils";
import {
  ArrowUp01Icon,
  Comment01Icon,
  LockIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";

/**
 * A request, open, at the size the product renders it.
 *
 * This is the picture the register page and the auth page both show: not a
 * shrunken screenshot of a whole app, but the one screen the product is for —
 * a post with its votes, its status, its body and the conversation under it.
 * At the width a split-panel leaves, this is the only view where every part of
 * the product (vote, status, board, comments) is legible at its real size
 * instead of being a thumbnail of itself.
 *
 * Every surface that renders it is decorative, so the caller owns the
 * `aria-hidden`: a screen reader reading a fictional request, its invented
 * votes and invented commenters would be describing a page that does not
 * exist. Nothing here is interactive for the same reason — the parts are
 * spans, and a cursor over them is a drawn cursor, not a control.
 */

export type ProductShotComment = {
  readonly author: string;
  readonly body: string;
  /** Draws the member tick, as comments by the workspace's own team do. */
  readonly isMember?: boolean;
};

export type ProductShotPost = {
  readonly author: string;
  /** Omitted when the reader kept no boards, so the badge disappears. */
  readonly board?: string;
  /** The post's opening paragraph, shown above the headings. */
  readonly intro?: string;
  readonly sections: readonly {
    readonly heading: string;
    readonly points: readonly string[];
  }[];
  readonly status: { readonly color: string; readonly label: string };
  readonly title: string;
  readonly voted?: boolean;
  readonly votes: number;
};

/**
 * The vote control, drawn to the compact trigger's geometry.
 *
 * Deliberately not the real `UpvoteButton`: that one reads a session, a live
 * query and a TanStack DB collection, none of which exist on a signed-out page
 * or on a page describing a workspace that has not been created. The size, the
 * radius and the voted palette are the real ones so the panel previews the
 * control honestly rather than approximating it.
 */
function VoteChip({
  count,
  voted = false,
}: {
  readonly count: number;
  readonly voted?: boolean;
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
      <HugeiconsIcon
        className="size-4 shrink-0"
        icon={ArrowUp01Icon}
        strokeWidth={2.5}
      />
      {count}
    </span>
  );
}

function StatusChip({
  status,
}: {
  readonly status: ProductShotPost["status"];
}) {
  return (
    <span className="border-border/70 bg-background inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: status.color }}
      />
      {status.label}
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

function CommentRow({ comment }: { readonly comment: ProductShotComment }) {
  return (
    // `items-start`: the avatar must not stretch with its comment's text, or
    // its member tick stretches with it.
    <div className="flex items-start gap-2.5 px-5 py-3">
      <UserAvatar isMember={comment.isMember} name={comment.author} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium">{comment.author}</span>
          <span className="text-muted-foreground text-[10px]">2d</span>
        </div>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          {comment.body}
        </p>
      </div>
    </div>
  );
}

/**
 * The composer at the foot of a post.
 *
 * A post page with no way to reply is a read-only page, and a preview that
 * hides the reply box leaves out the half of the product the reader is most
 * likely to use first.
 *
 * It follows the comments rather than being pinned to the window's bottom: a
 * fresh workspace has none, and a composer parked at the foot of a tall panel
 * leaves the hole between the two sections looking like a mistake. The page
 * ends here, and the empty space below it is the page's own — which is what a
 * post with no comments looks like.
 */
function CommentComposer() {
  return (
    <div className="border-border/60 bg-background flex shrink-0 items-center gap-2 border-t px-5 py-3">
      <span className="border-border text-muted-foreground flex h-9 min-w-0 flex-1 items-center rounded-lg border px-3 text-xs">
        Leave a comment…
      </span>
      <span className="bg-primary text-primary-foreground shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium">
        Comment
      </span>
    </div>
  );
}

/**
 * The frame above the request: whose board this is and where it lives. The
 * address is the register page's one live string — it is the subdomain the
 * server is checking while the reader types it.
 */
function BoardMasthead({
  host,
  logoUrl,
  name,
}: {
  readonly host: string;
  readonly logoUrl: string | null;
  readonly name: string;
}) {
  return (
    <div className="border-border/60 flex h-11 shrink-0 items-center gap-2 border-b px-5">
      <UserAvatar image={logoUrl} name={name} size="sm" />
      <span className="truncate text-xs font-medium">{name}</span>
      <span className="text-muted-foreground ml-auto flex min-w-0 items-center gap-1.5 text-[11px]">
        <HugeiconsIcon
          aria-hidden
          className="size-2.5 shrink-0 opacity-70"
          icon={LockIcon}
          strokeWidth={2}
        />
        <span className="truncate">{host}</span>
      </span>
    </div>
  );
}

export function ProductPostShot({
  comments,
  host,
  logoUrl,
  name,
  post,
}: {
  readonly comments: readonly ProductShotComment[];
  readonly host: string;
  readonly logoUrl: string | null;
  readonly name: string;
  readonly post: ProductShotPost;
}) {
  return (
    <div className="bg-background flex min-h-0 flex-1 flex-col">
      <BoardMasthead host={host} logoUrl={logoUrl} name={name} />

      <div className="flex shrink-0 flex-col gap-3 px-5 pt-4">
        <span className="text-muted-foreground text-[11px]">
          ← All feedback
        </span>

        <h2 className="text-xl leading-snug font-semibold tracking-tight text-balance">
          {post.title}
        </h2>

        <div className="flex items-center gap-2">
          <StatusChip status={post.status} />
          {post.board === undefined ? null : (
            <BoardBadge>{post.board}</BoardBadge>
          )}
        </div>

        <div className="flex items-center gap-3">
          <VoteChip count={post.votes} voted={post.voted} />
          <span className="bg-border h-4 w-px shrink-0" />
          <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-[11px]">
            <UserAvatar name={post.author} size="sm" />
            <span className="truncate">{post.author}</span>
          </span>
          <span className="text-muted-foreground ml-auto flex shrink-0 items-center gap-1 text-[11px] tabular-nums">
            <HugeiconsIcon
              className="size-3.5"
              icon={Comment01Icon}
              strokeWidth={2}
            />
            {comments.length}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-4 px-5 py-5">
        {post.intro === undefined ? null : (
          <p className="text-muted-foreground text-xs leading-relaxed">
            {post.intro}
          </p>
        )}

        {post.sections.map((section) => (
          <div className="flex flex-col gap-2" key={section.heading}>
            <h3 className="text-sm font-medium">{section.heading}</h3>
            <ul className="text-muted-foreground flex flex-col gap-1.5 text-xs leading-relaxed">
              {section.points.map((point) => (
                <li className="flex gap-2" key={point}>
                  <span aria-hidden className="text-border shrink-0">
                    •
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-border/60 flex flex-col border-t">
        <span className="text-muted-foreground px-5 pt-4 text-[10px] font-medium tracking-wider uppercase">
          Comments
        </span>

        {comments.length === 0 ? (
          <p className="text-muted-foreground px-5 py-4 text-xs leading-relaxed">
            No comments yet. They show up here, in order, for anyone who can
            read the board.
          </p>
        ) : (
          <div className="divide-border/40 flex flex-col divide-y">
            {comments.map((comment) => (
              <CommentRow comment={comment} key={comment.author} />
            ))}
          </div>
        )}
      </div>

      <CommentComposer />
    </div>
  );
}
