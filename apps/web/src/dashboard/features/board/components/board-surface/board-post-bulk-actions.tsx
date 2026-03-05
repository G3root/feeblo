import { useSelector } from "@xstate/store-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import {
  usePostSelectionStore,
  useSelectedPostIds,
} from "~/features/board/state/post-selection-context";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { postCollection } from "~/lib/collections";
import { fetchRpc } from "~/lib/runtime";
import { cn } from "~/lib/utils";

export function BoardPostBulkActions() {
  const selectedPostIds = useSelectedPostIds();
  const store = usePostSelectionStore();
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
  const store = usePostSelectionStore();
  const selectedPostIds = useSelectedPostIds();
  const open = useSelector(store, (state) => state.context.bulkDeleteOpen);

  const organizationId = useOrganizationId();

  return (
    <AlertDialog
      onOpenChange={(nextOpen) =>
        store.send({ type: "setBulkDeleteOpen", open: nextOpen })
      }
      open={open}
    >
      <AlertDialogContent>
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
                const boardId = store.get().context.boardId;
                if (!boardId) {
                  return;
                }
                await fetchRpc((rpc) =>
                  rpc.PostDelete({
                    id: selectedPostIds,
                    boardId,
                    organizationId,
                  })
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
      </AlertDialogContent>
    </AlertDialog>
  );
}
