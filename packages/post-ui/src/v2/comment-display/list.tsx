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

import { m } from "../../paraglide/messages.js";
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
  // A pinned reply is the post-wide highlighted comment: its thread reads
  // expanded so the pin is not hidden behind the collapsed accordion.
  const hasPinnedReply = replies.some((reply) => reply.pinnedAt != null);
  const [isExpanded, setIsExpanded] = useState(hasPinnedReply);
  const [prevHasPinnedReply, setPrevHasPinnedReply] = useState(hasPinnedReply);
  // Latch open on the false -> true transition (e.g. a reply is pinned
  // after mount). Derived during render instead of an effect: other replies
  // updates keep the current state, manual collapses stick, and an unpin
  // never auto-collapses an expanded thread.
  if (prevHasPinnedReply !== hasPinnedReply) {
    setPrevHasPinnedReply(hasPinnedReply);
    if (hasPinnedReply) {
      setIsExpanded(true);
    }
  }
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
              ? m.dull_close_thrush()
              : replies.length === 1
                ? m.fresh_smart_mare({ count: replies.length })
                : m.fit_aqua_beetle({ count: replies.length })}
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

/**
 * Narrows a survivor's comments to the threads that belong to a merged post:
 * roots tagged with `mergedFromPostId === mergedPostId` plus every descendant
 * reply. Replies added on the survivor after the merge are part of the moved
 * discussion, so the merged post's page shows the complete thread even though
 * the rows physically live on the survivor.
 */
function selectMergedThreadComments(
  comments: readonly TComment[],
  mergedPostId: string
): TComment[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const mergedRootIds = new Set(
    comments
      .filter((comment) => comment.mergedFromPostId === mergedPostId)
      .map((comment) => comment.id)
  );

  if (mergedRootIds.size === 0) {
    return [];
  }

  const belongsToMergedThread = (comment: TComment): boolean => {
    let current: TComment | undefined = comment;
    while (current) {
      if (mergedRootIds.has(current.id)) {
        return true;
      }
      const parentId: string | null =
        current.resolvedParentCommentId ?? current.parentCommentId;
      current = parentId == null ? undefined : byId.get(parentId);
    }
    return false;
  };

  return comments.filter(belongsToMergedThread);
}

export function CommentsList() {
  const { data: session } = useAuthState();
  const { organizationId, post, isMember } = usePostCollectionData();
  const {
    collections: { commentCollection, postCollection },
  } = usePostCollections();
  const postSlug = post.slug;
  const mergedIntoPostId = post.mergedIntoPostId;
  // Guests only see PUBLIC comments; members see everything.
  const visibility = isMember ? undefined : ("PUBLIC" as const);

  // A merged post's comments physically live on its survivor, so resolve the
  // survivor's slug and subscribe to its comment subset as well. The child
  // page then filters that subset down to this post's own merged threads.
  const { data: survivor, isLoading: isSurvivorLoading } = useLiveQuery(
    (query) => {
      if (!mergedIntoPostId) {
        return undefined;
      }
      return query
        .from({ post: postCollection })
        .where(({ post: survivorPost }) =>
          eq(survivorPost.id, mergedIntoPostId)
        )
        .findOne();
    },
    [mergedIntoPostId, postCollection]
  );
  const survivorSlug = survivor?.slug;

  const { data: ownComments, isLoading: isOwnCommentsLoading } = useLiveQuery(
    (q) =>
      q
        .from({ comment: commentCollection })
        .where(({ comment }) =>
          and(
            eq(comment.organizationId, organizationId),
            eq(comment.postSlug, postSlug),
            ...(visibility ? [eq(comment.visibility, visibility)] : [])
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

  const { data: survivorComments, isLoading: isSurvivorCommentsLoading } =
    useLiveQuery(
      (q) => {
        if (!survivorSlug) {
          return undefined;
        }
        return q
          .from({ comment: commentCollection })
          .where(({ comment }) =>
            and(
              eq(comment.organizationId, organizationId),
              eq(comment.postSlug, survivorSlug),
              ...(visibility ? [eq(comment.visibility, visibility)] : [])
            )
          )
          .orderBy(({ comment }) => comment.pinnedAt, {
            direction: "desc",
            nulls: "last",
          })
          .orderBy(({ comment }) => comment.createdAt, "desc");
      },
      [organizationId, survivorSlug, isMember]
    );

  const mergedComments = useMemo(
    () => selectMergedThreadComments(survivorComments ?? [], post.id),
    [survivorComments, post.id]
  );

  // The two subsets arrive pre-ordered; merge them back into one
  // pinned-first, newest-first list so a pinned merged comment still heads
  // the page.
  const comments = useMemo(() => {
    const combined = [...(ownComments ?? []), ...mergedComments];
    return combined.sort((left, right) => {
      const pinnedOrder =
        Number(right.pinnedAt != null) - Number(left.pinnedAt != null);
      return pinnedOrder !== 0
        ? pinnedOrder
        : right.createdAt.getTime() - left.createdAt.getTime();
    });
  }, [ownComments, mergedComments]);

  const threads = useMemo(() => buildThreads(comments), [comments]);

  if (isOwnCommentsLoading || isSurvivorLoading || isSurvivorCommentsLoading) {
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
