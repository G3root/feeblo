import { useEffect, useRef } from "react";

import { useCurrentMemberId } from "~/hooks/use-current-member-id";

import type {
  MyFeedbackScope,
  MyFeedbackView,
} from "../../lib/my-feedback-views";
import {
  type BoardGrouping,
  type BoardOrdering,
  BoardStoreProvider,
  type BoardView,
  useBoardStore,
} from "../../state/board-store-context";
import { BoardPosts } from "./board-posts";
import { BoardPostsLoading } from "./board-posts-loading";
import { BoardToolbar } from "./board-toolbar";

export function BoardSurface({
  boardId,
  boardSlug,
  organizationId,
  initialGrouping,
  initialOrdering,
  initialView,
  myFeedbackView,
  variant = "board",
}: {
  boardId?: string;
  boardSlug?: string;
  /** A saved view's stored grouping; omitted for the built-in presets. */
  initialGrouping?: BoardGrouping;
  /** A saved view's stored sort order; omitted for the built-in presets. */
  initialOrdering?: BoardOrdering;
  initialView: BoardView;
  /** Set on the member's own feedback page; scopes the live query to them. */
  myFeedbackView?: MyFeedbackView;
  organizationId: string;
  variant?: "board" | "feedback";
}) {
  const memberId = useCurrentMemberId(organizationId);
  // The view id is part of the key: two saved views are two surfaces even
  // though they share a board, so switching pills must seed a new store rather
  // than keep the previous view's filters, grouping and ordering. The personal
  // views are covered by the same rule: switching Created ↔ Assigned must hand
  // the store a new `initialView`, not the one it was mounted with.
  const surfaceKey = `${boardId ?? `${organizationId}:${variant}`}:${myFeedbackView ?? ""}:${initialView.id}`;

  // The scope is the session's member. A session refetch drops the member for a
  // render, and running the query unscoped for that render would list the whole
  // workspace under "Created by me" — so the posts area waits instead. The
  // provider and the toolbar stay mounted, because the member's search, filters
  // and display mode live in the store and a refetch is not a navigation.
  const myFeedbackScope: MyFeedbackScope | undefined =
    myFeedbackView !== undefined && memberId !== undefined
      ? { kind: myFeedbackView, memberId }
      : undefined;
  const isAwaitingMember =
    myFeedbackView !== undefined && myFeedbackScope === undefined;

  return (
    <BoardStoreProvider
      defaultValue={{
        activeView: initialView,
        boardId,
        ...(initialGrouping !== undefined && { grouping: initialGrouping }),
        ...(initialOrdering !== undefined && { ordering: initialOrdering }),
      }}
      key={surfaceKey}
    >
      <BoardViewSync
        initialGrouping={initialGrouping}
        initialOrdering={initialOrdering}
        initialView={initialView}
      />
      <div className="mx-auto flex h-full min-h-0 w-full flex-col">
        <div className="shrink-0">
          <BoardToolbar
            boardId={boardId}
            boardSlug={boardSlug}
            myFeedbackView={myFeedbackView}
            organizationId={organizationId}
            variant={variant}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {isAwaitingMember ? (
            <BoardPostsLoading />
          ) : (
            <BoardPosts
              boardId={boardId}
              myFeedbackScope={myFeedbackScope}
              organizationId={organizationId}
            />
          )}
        </div>
      </div>
    </BoardStoreProvider>
  );
}

/**
 * Applies a saved view's stored query when the row is refetched in place.
 *
 * `BoardStoreProvider` seeds its store once per surface key, which is what keeps
 * a local filter, grouping or ordering edit from being overwritten on every
 * render. The saved-view row can still change under a mounted surface — an edit
 * landing, or a shared view another member updated — and the screen has to
 * follow the row rather than keep the query it was first mounted with. The key
 * above deliberately stays on the view id, so this is the path that applies a
 * refetch without remounting the surface and losing local state.
 *
 * The signature is structural rather than an identity check because the route
 * rebuilds `initialView` on every render. That also means a refetch that returns
 * the same query does not write to the store and cannot clobber a local edit.
 * The name is deliberately not part of it: renaming a view does not change the
 * result set, so it must not reapply the row's query over a local board edit.
 */
function BoardViewSync({
  initialGrouping,
  initialOrdering,
  initialView,
}: {
  initialGrouping?: BoardGrouping;
  initialOrdering?: BoardOrdering;
  initialView: BoardView;
}) {
  const store = useBoardStore();
  const signature = JSON.stringify([
    initialView.id,
    initialView.filters,
    initialGrouping ?? null,
    initialOrdering ?? null,
  ]);
  const appliedSignature = useRef(signature);

  useEffect(() => {
    if (signature === appliedSignature.current) {
      return;
    }

    appliedSignature.current = signature;
    store.send({
      type: "setActiveView",
      view: initialView,
      ...(initialGrouping !== undefined && { grouping: initialGrouping }),
      ...(initialOrdering !== undefined && { ordering: initialOrdering }),
    });
  }, [initialGrouping, initialOrdering, initialView, signature, store]);

  return null;
}
