import {
  emptyBoardQuery,
  normalizeBoardFilters,
  type TBoardFilters,
  type TBoardGrouping,
} from "@feeblo/domain-contracts/board-query";
import { buttonVariants } from "@feeblo/ui/button";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";

import { BoardNotFound } from "~/features/board/components/board-not-found";
import { BoardSurface } from "~/features/board/components/board-surface";
import { BoardPostsLoading } from "~/features/board/components/board-surface/board-posts-loading";
import {
  BUILT_IN_VIEWS,
  type BuiltInView,
} from "~/features/board/lib/built-in-views";
import {
  MY_FEEDBACK_VIEWS,
  type MyFeedbackView,
} from "~/features/board/lib/my-feedback-views";
import type {
  BoardOrdering,
  BoardView,
} from "~/features/board/state/board-store-context";
import { useCurrentMemberId } from "~/hooks/use-current-member-id";
import { savedViewCollectionFor } from "~/lib/collections";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

type OrganizationPageProps = {
  /**
   * The stored grouping of a saved view. Built-in views leave it out and take
   * the store's status default.
   */
  initialGrouping?: TBoardGrouping;
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
  initialGrouping,
  initialOrdering,
  initialView,
  organizationId,
}: OrganizationPageProps) {
  return (
    <BoardSurface
      initialGrouping={initialGrouping}
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
  initialGrouping,
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
      initialGrouping={initialGrouping}
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

/**
 * The member's own feedback page: the posts they created, or the ones assigned
 * to them.
 *
 * The scope is a prop rather than part of `initialView.filters`: it is the
 * page's definition, so the filter menu cannot clear it and the tab strip has
 * no saved views to offer on top of it.
 */
export function MyFeedbackPage({
  organizationId,
  view,
}: {
  organizationId: string;
  view: MyFeedbackView;
}) {
  return (
    <BoardSurface
      initialView={myFeedbackBoardView(view)}
      myFeedbackView={view}
      organizationId={organizationId}
      variant="feedback"
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
 * The row *is* the route's data: its filters become the board's initial view,
 * its grouping the initial lanes, and its ordering the initial sort, so the URL
 * and the screen cannot disagree and a reload comes back to the same result
 * set. Another member's view, a deleted one, and one belonging to a different
 * surface all answer the same "not available" state — the caller cannot tell
 * which, so the dashboard cannot be used to probe for ids.
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
  const memberId = useCurrentMemberId(organizationId);
  const collection = useMemo(
    () => savedViewCollectionFor(organizationId, boardId, memberId),
    [organizationId, boardId, memberId]
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
      initialGrouping={view.query.grouping}
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
        It may have been deleted, or it may be a private view belonging to
        another member.
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
 * The three built-in views are the same shape as a saved view: a status filter
 * and nothing else. "Active" and "Backlog" are their `statusTypes`, so the
 * checklist the filter menu edits and the tab's own definition cannot
 * disagree, and a saved view of either tab is one document with one status
 * dimension.
 */
const builtInView = (key: BuiltInView): BoardView => {
  const view = BUILT_IN_VIEWS[key];

  return {
    filters: {
      ...emptyFilters(),
      status:
        view.statusTypes.length === 0
          ? null
          : { operator: "isAnyOf", types: view.statusTypes },
    },
    // The id is what the tab strip matches against `activeView.id` to know
    // which tab is current, so it has to be the same definition the strip
    // labels itself from.
    id: view.id,
    name: view.name,
  };
};

/**
 * A member's own feedback view: the shared empty query, with no status preset.
 *
 * "Created" and "Assigned" differ in the scope `BoardSurface` applies to the
 * live query, not in their filters, so the two views store the same filter set
 * and only their id and name distinguish them.
 */
const myFeedbackBoardView = (key: MyFeedbackView): BoardView => ({
  filters: emptyFilters(),
  id: MY_FEEDBACK_VIEWS[key].id,
  name: MY_FEEDBACK_VIEWS[key].name,
});

/**
 * The filter set every view starts from.
 *
 * A fresh copy per view, not the module-level `emptyBoardQuery` constant: two
 * mounted surfaces must not be able to reach one nested value.
 */
const emptyFilters = (): TBoardFilters =>
  normalizeBoardFilters(emptyBoardQuery.filters);

const allFeedbackView = builtInView("all");
const activeFeedbackView = builtInView("active");
const backlogFeedbackView = builtInView("backlog");
