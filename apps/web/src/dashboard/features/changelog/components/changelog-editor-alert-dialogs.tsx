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
    <AlertDialog
      onOpenChange={() => store.send({ type: "toggle" })}
      open={open}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Changelog</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete
            {` "${changelog.title || "this changelog"}".`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              store.send({ type: "toggle" });
              await handleDelete();
            }}
            variant="destructive"
          >
            Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ChangelogMoveToDraftDialog() {
  const store = useChangelogMoveToDraftDialogContext();
  const open = useSelector(store, (state) => state.context.open);
  const { changelog, handleMoveToDraft } = useChangelogEditorContext();

  return (
    <AlertDialog
      onOpenChange={() => store.send({ type: "toggle" })}
      open={open}
    >
      <AlertDialogContent>
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
          <AlertDialogAction
            onClick={async () => {
              store.send({ type: "toggle" });
              await handleMoveToDraft();
            }}
          >
            Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
