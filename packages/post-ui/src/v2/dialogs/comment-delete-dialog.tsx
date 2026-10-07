import { ConfirmDialog } from "@feeblo/ui/confirm-dialog";
import { toastManager } from "@feeblo/ui/toast";
import { settleOptimisticMutation } from "@feeblo/web-shared/collections";
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
    <ConfirmDialog
      cancelLabel={m.early_careful_coyote()}
      confirmLabel={m.clean_aqua_lion()}
      description={m.close_smart_wallaby()}
      onConfirm={() => {
        const id = store.get().context.data.commentId;
        // The row is removed optimistically, so the confirm closes in the
        // same tick; persistence settles in the background and rollback +
        // toast surface any failure.
        store.send({ type: "setOpen", open: false });
        settleOptimisticMutation(
          () => commentCollection.delete(id),
          () => {
            toastManager.add({
              title: m.mealy_soft_elk(),
              type: "success",
            });
          },
          () => {
            toastManager.add({
              title: m.day_spare_herring(),
              type: "error",
            });
          }
        );
      }}
      onOpenChange={(open) => store.send({ type: "setOpen", open })}
      open={open}
      title={m.due_same_millipede()}
    />
  );
}
