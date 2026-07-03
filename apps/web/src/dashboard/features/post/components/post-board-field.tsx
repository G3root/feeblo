import { PostBoardSelect } from "@feeblo/post-ui/post-properties";
import { toastManager } from "@feeblo/ui/toast";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useNavigate } from "@tanstack/react-router";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

interface PostBoardFieldProps {
  currentBoardId: string;
  disabled?: boolean;
  organizationId: string;
  postId: string;
  postSlug: string;
}

export function PostBoardField({
  currentBoardId,
  disabled,
  organizationId,
  postId,
  postSlug,
}: PostBoardFieldProps) {
  const navigate = useNavigate();
  const { boardCollection, postCollection } = useDashboardCollections();

  const { data: allBoards } = useLiveQuery(
    (q) => {
      return q
        .from({ board: boardCollection })
        .where(({ board }) => eq(board.organizationId, organizationId));
    },
    [organizationId]
  );

  if (!allBoards) {
    return null;
  }

  return (
    <PostBoardSelect
      boards={allBoards}
      currentBoardId={currentBoardId}
      disabled={disabled}
      onValueChange={async (boardId) => {
        if (!boardId || disabled) {
          return;
        }
        try {
          const nextBoard = allBoards.find((item) => item.id === boardId);
          const nextBoardSlug = nextBoard?.slug;
          const tx = postCollection.update(
            postId,
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

          if (!nextBoardSlug) {
            return;
          }

          navigate({
            to: "/$organizationId/post/$boardSlug/$postSlug",
            params: {
              organizationId,
              boardSlug: nextBoardSlug,
              postSlug,
            },
            replace: true,
          });
        } catch {
          toastManager.add({
            title: "Failed to update board",
            type: "error",
          });
        }
      }}
    />
  );
}
