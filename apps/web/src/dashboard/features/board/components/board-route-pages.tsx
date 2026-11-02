import { emptyBoardQuery } from "@feeblo/domain-contracts/board-query";
import { buttonVariants } from "@feeblo/ui/button";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";

import { BoardNotFound } from "~/features/board/components/board-not-found";
import { BoardSurface } from "~/features/board/components/board-surface";
import { BoardPostsLoading } from "~/features/board/components/board-surface/board-posts-loading";
import type {
  BoardOrdering,
  BoardPostStatusFilter,
  BoardView,
} from "~/features/board/state/board-store-context";
import { savedViewCollectionFor } from "~/lib/collections";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

type OrganizationPageProps = {
  /**
   * The stored sort order of a saved view. Built-in views leave it out and take
   * the store's default, which is the same order they have always had.
   */
  initialOrdering?: BoardOrdering;
  initialView: BoardView;
  organizationId: string;
};

type BoardPageProps = OrganizationPageProps & {
  boardSlug: string;
};

function OrganizationFeedbackPage({
  initialOrdering,
  initialView,
  organizationId,
}: OrganizationPageProps) {
  return (
    <BoardSurface
      initialOrdering={initialOrdering}
      initialView={initialView}
      organizationId={organizationId}
      variant="feedback"
    />
  );
}

/**
 * The board a URL names, resolved from the boards the shell already loaded.
 *
 * Shared by the built-in board pages and the saved-view pages: both are
 * `/board/$boardSlug/...` routes and both need the board's id before the
 * surface, and therefore the saved-view collection (which is keyed by board),
 * can exist.
 */
function useBoardBySlug(boardSlug: string, organizationId: string) {
  const { boardCollection } = useDashboardCollections();

  return useLiveQuery({
    queryKey: ["board-route", boardCollection.id, boardSlug, organizationId],
    query: (q) =>
      q
        .from({ board: boardCollection })
        .where((entry) =>
          and(
            eq(entry.board.slug, boardSlug),
            eq(entry.board.organizationId, organizationId)
          )
        )
        .findOne(),
  });
}

function BoardFeedbackPage({
  boardSlug,
  initialOrdering,
  initialView,
  organizationId,
}: BoardPageProps) {
  const { data: board } = useBoardBySlug(boardSlug, organizationId);

  if (!board) {
    return (
      <BoardNotFound boardSlug={boardSlug} organizationId={organizationId} />
    );
  }

  return (
    <BoardSurface
      boardId={board.id}
      boardSlug={boardSlug}
      initialOrdering={initialOrdering}
      initialView={initialView}
      organizationId={organizationId}
    />
  );
}

export function AllFeedbackPage({
  organizationId,
}: {
  organizationId: string;
}) {
  return (
    <OrganizationFeedbackPage
      initialView={allFeedbackView}
      organizationId={organizationId}
    />
  );
}

export function ActiveFeedbackPage({
  organizationId,
}: {
  organizationId: string;
}) {
  return (
    <OrganizationFeedbackPage
      initialView={activeFeedbackView}
      organizationId={organizationId}
    />
  );
}

export function BacklogFeedbackPage({
  organizationId,
}: {
  organizationId: string;
}) {
  return (
    <OrganizationFeedbackPage
      initialView={backlogFeedbackView}
      organizationId={organizationId}
    />
  );
}

export function AllBoardPage({
  boardSlug,
  organizationId,
}: {
  boardSlug: string;
  organizationId: string;
}) {
  return (
    <BoardFeedbackPage
      boardSlug={boardSlug}
      initialView={allFeedbackView}
      organizationId={organizationId}
    />
  );
}

export function ActiveBoardPage({
  boardSlug,
  organizationId,
}: {
  boardSlug: string;
  organizationId: string;
}) {
  return (
    <BoardFeedbackPage
      boardSlug={boardSlug}
      initialView={activeFeedbackView}
      organizationId={organizationId}
    />
  );
}

export function BacklogBoardPage({
  boardSlug,
  organizationId,
}: {
  boardSlug: string;
  organizationId: string;
}) {
  return (
    <BoardFeedbackPage
      boardSlug={boardSlug}
      initialView={backlogFeedbackView}
      organizationId={organizationId}
    />
  );
}

/** A saved view on the organization-wide feedback list. */
export function SavedFeedbackViewPage({
  organizationId,
  viewId,
}: {
  organizationId: string;
  viewId: string;
}) {
  return (
    <SavedViewSurface
      boardId={null}
      organizationId={organizationId}
      variant="feedback"
      viewId={viewId}
    />
  );
}

/** A saved view on one board. */
export function SavedBoardViewPage({
  boardSlug,
  organizationId,
  viewId,
}: {
  boardSlug: string;
  organizationId: string;
  viewId: string;
}) {
  const { data: board } = useBoardBySlug(boardSlug, organizationId);

  if (!board) {
    return (
      <BoardNotFound boardSlug={boardSlug} organizationId={organizationId} />
    );
  }

  return (
    <SavedViewSurface
      boardId={board.id}
      boardSlug={boardSlug}
      organizationId={organizationId}
      viewId={viewId}
    />
  );
}

/**
 * A saved view, resolved from its id.
 *
 * The row *is* the route's data: its filters become the board's initial view
 * and its ordering the initial sort, so the URL and the screen cannot disagree
 * and a reload comes back to the same result set. Another member's view, a
 * deleted one, and one belonging to a different surface all answer the same
 * "not available" state — the caller cannot tell which, so the dashboard cannot
 * be used to probe for ids.
 */
function SavedViewSurface({
  boardId,
  boardSlug,
  organizationId,
  variant,
  viewId,
}: {
  boardId: string | null;
  boardSlug?: string;
  organizationId: string;
  variant?: "board" | "feedback";
  viewId: string;
}) {
  const collection = useMemo(
    () => savedViewCollectionFor(organizationId, boardId),
    [organizationId, boardId]
  );

  const { data: view, isLoading } = useLiveQuery({
    queryKey: ["saved-view-route", collection.id, viewId],
    query: (q) =>
      q
        .from({ savedView: collection })
        .where(({ savedView }) => eq(savedView.id, viewId))
        .findOne(),
  });

  if (isLoading) {
    return <BoardPostsLoading />;
  }

  if (!view || view.boardId !== boardId) {
    return (
      <SavedViewUnavailable
        boardSlug={boardSlug}
        organizationId={organizationId}
      />
    );
  }

  return (
    <BoardSurface
      boardId={boardId ?? undefined}
      boardSlug={boardSlug}
      initialOrdering={view.query.ordering}
      initialView={{
        filters: view.query.filters,
        id: view.id,
        name: view.name,
      }}
      organizationId={organizationId}
      variant={variant}
    />
  );
}

function SavedViewUnavailable({
  boardSlug,
  organizationId,
}: {
  boardSlug?: string;
  organizationId: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-20 text-center">
      <p className="text-sm font-medium">This view isn’t available</p>
      <p className="text-muted-foreground max-w-sm text-sm">
        It may have been deleted, or it belongs to another member — saved views
        are personal to the member who made them.
      </p>
      {boardSlug ? (
        <Link
          className={buttonVariants({ size: "sm", variant: "outline" })}
          params={{ boardSlug, organizationId }}
          to="/$organizationId/board/$boardSlug"
        >
          Back to this board
        </Link>
      ) : (
        <Link
          className={buttonVariants({ size: "sm", variant: "outline" })}
          params={{ organizationId }}
          to="/$organizationId/feedback"
        >
          Back to all feedback
        </Link>
      )}
    </div>
  );
}

/**
 * The three built-in views differ only in their status preset, so each one is
 * the shared empty query with that preset replaced. Writing the filters out
 * three times is what let the persisted `BoardFilters` and the built-in views
 * drift apart by a field in the first place.
 */
const builtInView = (
  id: string,
  name: string,
  postStatus: BoardPostStatusFilter
): BoardView => ({
  filters: {
    ...emptyBoardQuery.filters,
    assigneeMemberIds: [...emptyBoardQuery.filters.assigneeMemberIds],
    postStatus,
    statuses: [...emptyBoardQuery.filters.statuses],
    tagIds: [...emptyBoardQuery.filters.tagIds],
  },
  id,
  name,
});

const allFeedbackView = builtInView("all-feedback", "All feedbacks", "all");
const activeFeedbackView = builtInView("active-feedback", "Active", "active");
const backlogFeedbackView = builtInView(
  "backlog-feedback",
  "Backlog",
  "backlog"
);
