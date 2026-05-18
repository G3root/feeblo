import { and, eq, useLiveSuspenseQuery } from "@tanstack/react-db";
import { Skeleton } from "@feeblo/ui/skeleton";
import { BoardNotFound } from "~/features/board/components/board-not-found";
import { BoardSurface } from "~/features/board/components/board-surface";
import type { BoardView } from "~/features/board/state/board-store-context";
import { boardCollection } from "~/lib/collections";

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
  const { data: board } = useLiveSuspenseQuery(
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

export function BoardFeedbackRoutePending() {
  return (
    <div className="mx-auto w-full">
      <section className="overflow-hidden text-card-foreground">
        <div className="space-y-6 border-b px-4 py-6 lg:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-28" />
            </div>
            <Skeleton className="h-9 w-28 rounded-md" />
          </div>
        </div>
        <div className="space-y-3 px-4 py-4 lg:px-6">
          <Skeleton className="h-11 w-full rounded-none" />
          <Skeleton className="h-11 w-full rounded-none" />
          <Skeleton className="h-11 w-full rounded-none" />
        </div>
      </section>
    </div>
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
