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
import { useCommentVisibilityDialogContext } from "../dialog-stores/comment-visibility";
import { usePostCollections } from "../providers/post-collections-provider";

export function CommentVisibilityDialog() {
  const store = useCommentVisibilityDialogContext();
  const {
    collections: { commentCollection },
  } = usePostCollections();
  const open = useSelector(store, (state) => state.context.open);
  const isInternal = useSelector(
    store,
    (state) => state.context.data.isInternal
  );

  return (
    <AlertDialog
      onOpenChange={() => store.send({ type: "toggle" })}
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isInternal ? m.male_civil_lionfish() : m.nice_super_octopus()}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isInternal ? m.weary_free_jaguar() : m.orange_lime_jackal()}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{m.early_careful_coyote()}</AlertDialogCancel>
          <Button
            onClick={async () => {
              try {
                const { commentId, isInternal } = store.get().context.data;
                const tx = commentCollection.update(commentId, (draft) => {
                  draft.visibility = isInternal ? "PUBLIC" : "INTERNAL";
                });
                await tx.isPersisted.promise;
                toastManager.add({
                  title: isInternal
                    ? m.moving_vivid_duck()
                    : m.giant_factual_midge(),
                  type: "success",
                });
                store.send({ type: "toggle" });
              } catch {
                toastManager.add({
                  title: m.patient_dry_iguana(),
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
