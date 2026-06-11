import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { BoardNotFound } from "~/features/board/components/board-not-found";
import { BoardSurface } from "~/features/board/components/board-surface";
import type { BoardView } from "~/features/board/state/board-store-context";
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
  const { data: board } = useLiveQuery(
    (q) =>
      q
        .from({ board: boardCollection })
        .where((entry) =>
          and(
            eq(entry.board.slug, boardSlug),
            eq(entry.board.organizationId, organizationId)
          )
        )
        .findOne(),
    [boardSlug, organizationId]
  );

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

const allFeedbackView: BoardView = {
  id: "all-feedback",
  name: "All feedbacks",
  filters: {
    postStatus: "all",
    search: "",
    statusOperator: "isAnyOf",
    statuses: [],
    tagOperator: "includeAllOf",
    tagIds: [],
  },
};

const activeFeedbackView: BoardView = {
  id: "active-feedback",
  name: "Active",
  filters: {
    postStatus: "active",
    search: "",
    statusOperator: "isAnyOf",
    statuses: [],
    tagOperator: "includeAllOf",
    tagIds: [],
  },
};

const backlogFeedbackView: BoardView = {
  id: "backlog-feedback",
  name: "Backlog",
  filters: {
    postStatus: "backlog",
    search: "",
    statusOperator: "isAnyOf",
    statuses: [],
    tagOperator: "includeAllOf",
    tagIds: [],
  },
};
