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
