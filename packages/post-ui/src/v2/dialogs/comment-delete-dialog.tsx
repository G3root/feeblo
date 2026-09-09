import {
  AlertDialog,
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

import { m } from "../../paraglide/messages.js";
import { useCommentDeleteDialogContext } from "../dialog-stores/comment";
import { usePostCollections } from "../providers/post-collections-provider";

export function CommentDeleteDialog() {
  const store = useCommentDeleteDialogContext();
  const {
    collections: { commentCollection },
  } = usePostCollections();
  const open = useSelector(store, (state) => state.context.open);
  return (
    <AlertDialog
      onOpenChange={() => store.send({ type: "toggle" })}
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.due_same_millipede()}</AlertDialogTitle>
          <AlertDialogDescription>
            {m.close_smart_wallaby()}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{m.early_careful_coyote()}</AlertDialogCancel>
          <Button
            onClick={async () => {
              try {
                const id = store.get().context.data.commentId;
                const tx = commentCollection.delete(id);
                await tx.isPersisted.promise;
                toastManager.add({
                  title: m.mealy_soft_elk(),
                  type: "success",
                });
                store.send({ type: "toggle" });
              } catch {
                toastManager.add({
                  title: m.day_spare_herring(),
                  type: "error",
                });
              }
            }}
            variant="destructive"
          >
            {m.clean_aqua_lion()}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
