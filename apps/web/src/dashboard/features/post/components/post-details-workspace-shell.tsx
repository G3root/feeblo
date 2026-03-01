import {
  Copy01Icon,
  LinkSquare02Icon,
  Trash2,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveSuspenseQuery } from "@tanstack/react-db";
import { useNavigate } from "@tanstack/react-router";
import { Suspense } from "react";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import { SidebarTrigger } from "~/components/ui/sidebar";
import { Skeleton } from "~/components/ui/skeleton";
import { toastManager } from "~/components/ui/toast";
import { formatPostDate } from "~/features/board/components/board-surface/utils";
import { BOARD_LANES, type BoardPostStatus } from "~/features/board/constants";
import { getPublicSiteUrl } from "~/hooks/use-site";
import { boardCollection, postCollection } from "~/lib/collections";
import { usePostDeleteDialogContext } from "../dialog-stores";

const STATUS_DOT_COLORS: Record<BoardPostStatus, string> = {
  IN_PROGRESS: "#3b82f6",
  REVIEW: "#f59e0b",
  PLANNED: "#6b7280",
  COMPLETED: "#22c55e",
  PAUSED: "#eab308",
  CLOSED: "#ef4444",
};

const STATUS_LABELS: Record<BoardPostStatus, string> = {
  IN_PROGRESS: "In Progress",
  REVIEW: "In Review",
  PLANNED: "Planned",
  COMPLETED: "Completed",
  PAUSED: "Paused",
  CLOSED: "Closed",
};

export type PostDetailsRouteParams = {
  boardSlug: string;
  organizationId: string;
  postSlug: string;
};

export function PostDetailsWorkspaceShell({
  children,
  params,
}: {
  children: React.ReactNode;
  params: PostDetailsRouteParams;
}) {
  return (
    <Suspense fallback={<PostDetailsWorkspaceShellSkeleton />}>
      <PostDetailsWorkspaceShellContent params={params}>
        {children}
      </PostDetailsWorkspaceShellContent>
    </Suspense>
  );
}

function PostDetailsWorkspaceShellContent({
  children,
  params,
}: {
  children: React.ReactNode;
  params: PostDetailsRouteParams;
}) {
  const { data: board } = useLiveSuspenseQuery(
    (q) => {
      return q
        .from({ board: boardCollection })
        .where(({ board }) =>
          and(
            eq(board.slug, params.boardSlug),
            eq(board.organizationId, params.organizationId)
          )
        )
        .findOne();
    },
    [params.boardSlug, params.organizationId]
  );

  const { data: allBoards } = useLiveSuspenseQuery(
    (q) => {
      return q
        .from({ board: boardCollection })
        .where(({ board }) => eq(board.organizationId, params.organizationId));
    },
    [params.organizationId]
  );

  const { data: post } = useLiveSuspenseQuery(
    (q) => {
      return q
        .from({ post: postCollection })
        .where(({ post }) =>
          and(
            eq(post.slug, params.postSlug),
            eq(post.organizationId, params.organizationId),
            eq(post.boardId, board?.id)
          )
        )
        .findOne();
    },
    [params.postSlug, params.organizationId, board?.id]
  );

  const currentStatus = (post?.status as BoardPostStatus) ?? "PLANNED";
  const currentBoardId = board?.id ?? "";
  const navigate = useNavigate();
  const postDialogStore = usePostDeleteDialogContext();

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex min-h-0 flex-col overflow-hidden">
        <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
          <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
            <SidebarTrigger className="-ml-1" />
          </div>
        </header>

        <ScrollArea className="min-h-0 flex-1 overflow-hidden">
          {children}
        </ScrollArea>
      </div>

      <aside className="hidden border-l bg-muted/20 px-6 pt-2 lg:block">
        <div className="flex items-center justify-end gap-2">
          <RedirectToPostUrlButton postSlug={post?.slug ?? ""} />
          <CopyPostButton postSlug={post?.slug ?? ""} />
          <Button
            aria-label="Close"
            onClick={() =>
              postDialogStore.send({
                type: "toggle",
                data: {
                  postId: post?.id ?? "",
                  redirectOptions: {
                    to: "/$organizationId/board/$boardSlug",
                    params: {
                      organizationId: params.organizationId,
                      boardSlug: params.boardSlug,
                    },
                  },
                },
              })
            }
            size="icon-sm"
            variant="outline"
          >
            <HugeiconsIcon icon={Trash2} />
          </Button>
        </div>
        <div className="mt-4 text-sm">
          <PropertyRow label="Status">
            <StatusSelect
              currentStatus={currentStatus}
              onValueChange={async (status) => {
                if (!post) {
                  return;
                }
                if (!status) {
                  return;
                }
                try {
                  const tx = postCollection.update(post.id, (draft) => {
                    draft.status = status;
                  });
                  await tx.isPersisted.promise;

                  toastManager.add({
                    title: "Status updated",
                    type: "success",
                  });
                } catch (_error) {
                  toastManager.add({
                    title: "Failed to update status",
                    type: "error",
                  });
                }
              }}
            />
          </PropertyRow>

          <PropertyRow label="Board">
            <BoardSelect
              boards={allBoards}
              currentBoardId={currentBoardId}
              onValueChange={async (boardId) => {
                if (!post) {
                  return;
                }
                if (!boardId) {
                  return;
                }
                try {
                  const board = allBoards.find((b) => b.id === boardId);
                  const boardSlug = board?.slug;
                  const tx = postCollection.update(
                    post.id,
                    {
                      optimistic: false,
                    },
                    (draft) => {
                      draft.boardId = boardId;
                    }
                  );
                  await tx.isPersisted.promise;

                  toastManager.add({
                    title: "Board updated",
                    type: "success",
                  });

                  if (!boardSlug) {
                    return;
                  }

                  navigate({
                    to: "/$organizationId/board/$boardSlug/$postSlug",
                    params: {
                      organizationId: params.organizationId,
                      boardSlug,
                      postSlug: params.postSlug,
                    },
                    replace: true,
                  });
                } catch (_error) {
                  toastManager.add({
                    title: "Failed to update board",
                    type: "error",
                  });
                }
              }}
            />
          </PropertyRow>

          <Separator />

          <PropertyRow label="Date">
            <p className="text-muted-foreground text-sm">
              {formatPostDate(post?.createdAt ?? new Date())}
            </p>
          </PropertyRow>
          <PropertyRow label="Author">
            <p className="text-muted-foreground text-sm">
              {post?.user?.name ?? "Unknown author"}
            </p>
          </PropertyRow>
        </div>
      </aside>
    </div>
  );
}

const RedirectToPostUrlButton = ({ postSlug }: { postSlug: string }) => {
  const publicSiteUrl = getPublicSiteUrl();
  if (!publicSiteUrl) {
    return null;
  }
  return (
    <Button
      nativeButton={false}
      render={(props) => (
        <a
          {...props}
          href={`${publicSiteUrl}/p/${postSlug}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          <HugeiconsIcon icon={LinkSquare02Icon} />
        </a>
      )}
      size="icon-sm"
      variant="outline"
    />
  );
};

function PropertyRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function CopyPostButton({ postSlug }: { postSlug: string }) {
  const publicSiteUrl = getPublicSiteUrl();
  if (!publicSiteUrl) {
    return null;
  }
  return (
    <Button
      onClick={() => {
        try {
          navigator.clipboard.writeText(`${publicSiteUrl}/p/${postSlug}`);
          toastManager.add({
            title: "Post URL copied to clipboard",
            type: "success",
          });
        } catch (_error) {
          toastManager.add({
            title: "Failed to copy post URL to clipboard",
            type: "error",
          });
        }
      }}
      size="icon-sm"
      variant="outline"
    >
      <HugeiconsIcon icon={Copy01Icon} />
    </Button>
  );
}

function StatusSelect({
  currentStatus,
  onValueChange,
}: {
  currentStatus: BoardPostStatus;
  onValueChange: (status: BoardPostStatus | null) => void;
}) {
  return (
    <Select onValueChange={onValueChange} value={currentStatus}>
      <SelectTrigger className="w-full">
        <SelectValue>
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: STATUS_DOT_COLORS[currentStatus] }}
          />
          {STATUS_LABELS[currentStatus]}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {BOARD_LANES.map((lane) =>
          lane.statuses.map((status) => (
            <SelectItem key={status} value={status}>
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: STATUS_DOT_COLORS[status] }}
              />
              {STATUS_LABELS[status]}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}

function BoardSelect({
  boards,
  currentBoardId,
  onValueChange,
}: {
  boards: { id: string; name: string }[];
  currentBoardId: string;
  onValueChange: (boardId: string | null) => void;
}) {
  const currentBoard = boards.find((b) => b.id === currentBoardId);

  return (
    <Select onValueChange={onValueChange} value={currentBoardId}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select board">
          {currentBoard?.name ?? "Select board"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {boards.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PostDetailsWorkspaceShellSkeleton() {
  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex min-h-0 flex-col overflow-hidden">
        <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b">
          <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
        </header>

        <ScrollArea className="min-h-0 flex-1 overflow-hidden">
          <div className="p-4 md:p-6">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="mt-6 h-24 w-full" />
            <Skeleton className="mt-6 h-20 w-full rounded-xl" />
          </div>
        </ScrollArea>
      </div>

      <aside className="hidden border-l bg-muted/20 px-6 py-6 lg:block">
        <Skeleton className="h-4 w-24" />
        <div className="mt-6 space-y-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </aside>
    </div>
  );
}
