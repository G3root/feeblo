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
import { toastManager } from "~/components/ui/toast";
import { boardCollection } from "~/lib/collections";
import { useDeleteBoardDialogContext } from "../dialog-stores";

export function DeleteBoardDialog() {
  const store = useDeleteBoardDialogContext();

  const open = useSelector(store, (state) => state.context.open);

  return (
    <AlertDialog
      onOpenChange={() => store.send({ type: "toggle" })}
      open={open}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete the
            board.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              try {
                const id = store.get().context.data.boardId;
                store.send({ type: "toggle" });
                const tx = boardCollection.delete(id);
                await tx.isPersisted.promise;
                toastManager.add({
                  title: "Board deleted successfully",
                  type: "success",
                });
              } catch (_error) {
                toastManager.add({
                  title: "Failed to delete board",
                  type: "error",
                });
              }
            }}
          >
            Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
