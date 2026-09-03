import type { TComment } from "@feeblo/domain/src/comments/schema.js";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@feeblo/ui/collapsible";
import { cn } from "@feeblo/ui/utils";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { ChevronRightIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useCallback, useMemo, useState } from "react";

import { usePostCollectionData } from "../post-page-context";
import { usePostCollections } from "../providers/post-collections-provider";
import { CommentDisplayItem } from "./list-item";
import { CommentThreadContext } from "./thread-context";

/** A top-level comment plus the replies rendered inside its thread. */
interface CommentThread {
  comment: TComment;
  replies: TComment[];
}

/**
 * Groups a flat comment list into single-level threads in O(n): each
 * comment's root is resolved once along its parent chain and cached
 * (path compression), so deep reply chains cost one walk total, not per
 * comment. Replies to replies are flattened under their root ancestor, so
 * a parent hidden from the current viewer (e.g. toggled INTERNAL for public
 * guests) cannot orphan its descendants: the public list carries each
 * comment's `resolvedParentCommentId`, re-anchored to the nearest visible
 * ancestor, so they surface beneath it rather than as unrelated roots.
 *
 * Thread roots keep the query order (pinned first, then newest). Replies
 * inside a thread read chronologically (oldest first), with a pinned reply
 * sorted above its siblings.
 */
function buildThreads(comments: readonly TComment[]): CommentThread[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const rootIdByCommentId = new Map<string, string>();
  const roots: TComment[] = [];
  const repliesByRootId = new Map<string, TComment[]>();

  // Iterative root resolution with path compression: every comment on the
  // walked chain is cached, so later threads resolve in one lookup. The
  // parent graph is a forest (parentCommentId is set once at creation to an
  // already-persisted comment and never updated), so this terminates.
  const resolveRootId = (comment: TComment): string => {
    const path: TComment[] = [];
    let current = comment;
    let rootId = rootIdByCommentId.get(current.id);
    while (rootId === undefined) {
      path.push(current);
      // The list carries the nearest visible ancestor (`resolvedParentCommentId`)
      // for callers who cannot see every comment; fall back to the raw parent
      // for rows where the server sent no resolution.
      const parentId =
        current.resolvedParentCommentId ?? current.parentCommentId;
      const parent = parentId == null ? undefined : byId.get(parentId);
      if (!parent) {
        // Top-level comment, or a reply with no visible ancestor left: it
        // roots its own thread.
        rootId = current.id;
      } else {
        current = parent;
        rootId = rootIdByCommentId.get(current.id);
      }
    }
    for (const node of path) {
      rootIdByCommentId.set(node.id, rootId);
    }
    return rootId;
  };

  for (const comment of comments) {
    const rootId = resolveRootId(comment);
    if (rootId === comment.id) {
      roots.push(comment);
      continue;
    }
    const siblings = repliesByRootId.get(rootId);
    if (siblings) {
      siblings.push(comment);
    } else {
      repliesByRootId.set(rootId, [comment]);
    }
  }

  return roots.map((comment) => {
    const replies = (repliesByRootId.get(comment.id) ?? []).sort((a, b) => {
      const pinnedOrder =
        Number(b.pinnedAt != null) - Number(a.pinnedAt != null);
      if (pinnedOrder !== 0) {
        return pinnedOrder;
      }
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    return { comment, replies };
  });
}

function CommentThreadRow({
  comment,
  replies,
  currentUserId,
}: CommentThread & { currentUserId?: string }) {
  const [isExpanded, setIsExpanded] = useState(
    // A pinned reply is the post-wide highlighted comment: start its thread
    // expanded so the pin is not hidden behind the collapsed accordion.
    () => replies.some((reply) => reply.pinnedAt != null)
  );
  const expandReplies = useCallback(() => setIsExpanded(true), []);

  return (
    <div data-slot="comment-thread">
      <CommentThreadContext value={{ expandReplies }}>
        <CommentDisplayItem currentUserId={currentUserId} data={comment} />
      </CommentThreadContext>
      {replies.length > 0 && (
        <Collapsible
          className="mt-1.5 ml-8"
          onOpenChange={setIsExpanded}
          open={isExpanded}
        >
          <CollapsibleTrigger
            className="text-muted-foreground hover:text-foreground hover:bg-accent -ml-2 flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors"
            type="button"
          >
            <HugeiconsIcon
              className={cn("transition-transform", isExpanded && "rotate-90")}
              icon={ChevronRightIcon}
              size={14}
            />
            {isExpanded
              ? "Hide replies"
              : `Show ${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="border-border/70 mt-1.5 flex flex-col gap-1 border-l py-1 pl-4">
              {replies.map((reply) => (
                <CommentDisplayItem
                  currentUserId={currentUserId}
                  data={reply}
                  key={reply.id}
                />
              ))}
            </div>
          </CollapsiblePanel>
        </Collapsible>
      )}
    </div>
  );
}

export function CommentsList() {
  const { data: session } = useAuthState();
  const { organizationId, post, isMember } = usePostCollectionData();
  const {
    collections: { commentCollection },
  } = usePostCollections();
  const postSlug = post.slug;

  const { data: comments, isLoading: isCommentsLoading } = useLiveQuery(
    (q) =>
      q
        .from({ comment: commentCollection })
        .where(({ comment }) =>
          and(
            eq(comment.organizationId, organizationId),
            eq(comment.postSlug, postSlug),
            ...(isMember ? [] : [eq(comment.visibility, "PUBLIC")])
          )
        )
        // `nulls: "last"` matters: TanStack DB's desc default is NULLS FIRST
        // (matching Postgres), so without it unpinned comments (pinnedAt =
        // null) would sort above the pinned one. Mirrors the SQL
        // `pinnedAt DESC NULLS LAST, createdAt DESC` in the repository.
        .orderBy(({ comment }) => comment.pinnedAt, {
          direction: "desc",
          nulls: "last",
        })
        .orderBy(({ comment }) => comment.createdAt, "desc"),
    [organizationId, postSlug, isMember]
  );

  const threads = useMemo(() => buildThreads(comments ?? []), [comments]);

  if (isCommentsLoading) {
    return null;
  }

  return threads.map((thread) => (
    <CommentThreadRow
      currentUserId={session?.user?.id}
      key={thread.comment.id}
      {...thread}
    />
  ));
}
