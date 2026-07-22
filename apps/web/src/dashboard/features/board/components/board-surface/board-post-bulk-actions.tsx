import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogPopup,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@feeblo/ui/alert-dialog";
import { Button } from "@feeblo/ui/button";
import { toastManager } from "@feeblo/ui/toast";
import { useSelector } from "@xstate/store-react";
import {
  useBoardStore,
  useSelectedPostIds,
  useSelectedPosts,
} from "~/features/board/state/board-store-context";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { fetchRpc } from "~/lib/runtime";
import { cn } from "@feeblo/ui/utils";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

export function BoardPostBulkActions() {
  const selectedPostIds = useSelectedPostIds();
  const store = useBoardStore();
  const selectedCount = selectedPostIds.length;

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-3 transition-all duration-200 sm:px-6",
        selectedCount > 0
          ? "translate-y-0 opacity-100"
          : "translate-y-5 opacity-0"
      )}
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur-sm">
        <p className="font-medium text-sm">{selectedCount} selected</p>
        <Button
          onClick={() => store.send({ type: "clearSelection" })}
          size="sm"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button
          onClick={() => store.send({ type: "setBulkDeleteOpen", open: true })}
          size="sm"
          type="button"
          variant="destructive"
        >
          Delete
        </Button>
      </div>
      <BulkDeleteAlert />
    </div>
  );
}

function BulkDeleteAlert() {
  const store = useBoardStore();
  const { postCollection } = useDashboardCollections();
  const selectedPostIds = useSelectedPostIds();
  const selectedPosts = useSelectedPosts();
  const open = useSelector(store, (state) => state.context.bulkDeleteOpen);

  const organizationId = useOrganizationId();

  return (
    <AlertDialog
      onOpenChange={(nextOpen) =>
        store.send({ type: "setBulkDeleteOpen", open: nextOpen })
      }
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete selected posts</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete{" "}
            {selectedPostIds.length} selected post
            {selectedPostIds.length === 1 ? "" : "s"}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              if (selectedPostIds.length === 0) {
                store.send({ type: "setBulkDeleteOpen", open: false });
                return;
              }

              try {
                const postIdsByBoardId = new Map<string, string[]>();

                for (const selectedPost of selectedPosts) {
                  const boardPostIds =
                    postIdsByBoardId.get(selectedPost.boardId) ?? [];
                  boardPostIds.push(selectedPost.postId);
                  postIdsByBoardId.set(selectedPost.boardId, boardPostIds);
                }

                await Promise.all(
                  [...postIdsByBoardId.entries()].map(([boardId, postIds]) =>
                    fetchRpc((rpc) =>
                      rpc.PostDelete({
                        id: postIds,
                        boardId,
                        organizationId,
                      })
                    )
                  )
                );

                await postCollection.utils.refetch();

                store.send({ type: "clearSelection" });
                store.send({ type: "setBulkDeleteOpen", open: false });
                toastManager.add({
                  title: `${selectedPostIds.length} post${
                    selectedPostIds.length === 1 ? "" : "s"
                  } deleted successfully`,
                  type: "success",
                });
              } catch (_error) {
                console.error(_error);
                toastManager.add({
                  title: "Failed to delete selected posts",
                  type: "error",
                });
              }
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
