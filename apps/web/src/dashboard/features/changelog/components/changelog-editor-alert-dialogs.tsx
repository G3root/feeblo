import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@feeblo/ui/alert-dialog";
import { Button } from "@feeblo/ui/button";
import { ConfirmDialog } from "@feeblo/ui/confirm-dialog";
import { useSelector } from "@xstate/store-react";

import {
  useChangelogDeleteDialogContext,
  useChangelogMoveToDraftDialogContext,
} from "../dialog-stores";
import { useChangelogEditorContext } from "./changelog-editor";

export function ChangelogDeleteDialog() {
  const store = useChangelogDeleteDialogContext();
  const open = useSelector(store, (state) => state.context.open);
  const { changelog, handleDelete } = useChangelogEditorContext();

  return (
    <ConfirmDialog
      description={`This action cannot be undone. This will permanently delete "${changelog.title || "this changelog"}".`}
      onConfirm={async () => {
        await handleDelete();
        store.send({ type: "setOpen", open: false });
      }}
      onOpenChange={(open) => store.send({ type: "setOpen", open })}
      open={open}
      title="Delete Changelog"
    />
  );
}

export function ChangelogMoveToDraftDialog() {
  const store = useChangelogMoveToDraftDialogContext();
  const open = useSelector(store, (state) => state.context.open);
  const { changelog, handleMoveToDraft } = useChangelogEditorContext();

  return (
    <AlertDialog
      onOpenChange={(open) => store.send({ type: "setOpen", open })}
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Move To Draft</AlertDialogTitle>
          <AlertDialogDescription>
            This will move
            {` "${changelog.title || "this changelog"}" `}
            back to draft and clear any scheduled or published state.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            onClick={async () => {
              await handleMoveToDraft();
              store.send({ type: "setOpen", open: false });
            }}
          >
            Continue
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
