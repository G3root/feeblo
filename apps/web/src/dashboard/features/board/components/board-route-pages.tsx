import { emptyBoardQuery } from "@feeblo/domain-contracts/board-query";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useMemo } from "react";

import { BoardNotFound } from "~/features/board/components/board-not-found";
import { BoardSurface } from "~/features/board/components/board-surface";
import type {
  BoardPostStatusFilter,
  BoardView,
} from "~/features/board/state/board-store-context";
import { useCurrentMemberId } from "~/hooks/use-current-member-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

type OrganizationPageProps = {
  initialView: BoardView;
  organizationId: string;
};

type BoardPageProps = OrganizationPageProps & {
  boardSlug: string;
};

function OrganizationFeedbackPage({
  initialView,
  organizationId,
}: OrganizationPageProps) {
  return (
    <BoardSurface
      initialView={initialView}
      organizationId={organizationId}
      variant="feedback"
    />
  );
}

function BoardFeedbackPage({
  boardSlug,
  initialView,
  organizationId,
}: BoardPageProps) {
  const { boardCollection } = useDashboardCollections();
  const { data: board } = useLiveQuery({
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

  if (!board) {
    return (
      <BoardNotFound boardSlug={boardSlug} organizationId={organizationId} />
    );
  }

  return (
    <BoardSurface
      boardId={board.id}
      boardSlug={boardSlug}
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
 * "Assigned to me", resolved against the session's member row.
 *
 * The route cannot be a static view like All/Active/Backlog because the member
 * id only exists at render time. It is resolved before the surface mounts (the
 * dashboard's auth guard awaits the session), so the store's initial view and
 * the visible rows agree from the first paint rather than the board briefly
 * showing every post.
 */
export function AssignedFeedbackPage({
  organizationId,
}: {
  organizationId: string;
}) {
  const memberId = useCurrentMemberId(organizationId);
  const initialView = useMemo(() => assignedView(memberId), [memberId]);

  return (
    <OrganizationFeedbackPage
      initialView={initialView}
      organizationId={organizationId}
    />
  );
}

export function AssignedBoardPage({
  boardSlug,
  organizationId,
}: {
  boardSlug: string;
  organizationId: string;
}) {
  const memberId = useCurrentMemberId(organizationId);
  const initialView = useMemo(() => assignedView(memberId), [memberId]);

  return (
    <BoardFeedbackPage
      boardSlug={boardSlug}
      initialView={initialView}
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

/**
 * The assigned view for one member.
 *
 * A missing member id leaves the filter empty rather than rendering a broken
 * view: it means the session has no membership row for this workspace, which
 * the dashboard's own guard already redirects away from — but a stale session
 * should show an unfiltered board, not an empty one that reads as "nothing is
 * assigned to you".
 */
function assignedView(assigneeMemberId: string | undefined): BoardView {
  const view = builtInView("assigned-to-me", "Assigned to me", "all");

  return {
    ...view,
    filters: {
      ...view.filters,
      assigneeMemberIds: assigneeMemberId ? [assigneeMemberId] : [],
    },
  };
}
