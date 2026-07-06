/** biome-ignore-all lint/performance/noBarrelFile: <explanation> */
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@feeblo/ui/dialog";
import { useSelector } from "@xstate/store-react";
import { lazy, Suspense } from "react";
import { usePostCreateDialogContext } from "../dialog-stores/post";

const PostCreateForm = lazy(() =>
  import("./post-create-form-inner").then((mod) => ({
    default: mod.PostCreateForm,
  }))
);

function PostCreateFormFallback() {
  return (
    <div className="flex h-full items-center justify-center p-12">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground" />
    </div>
  );
}

export function PostCreateDialog() {
  const store = usePostCreateDialogContext();
  const open = useSelector(store, (state) => state.context.open);
  return (
    <Dialog onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <DialogPopup
        className="md:min-h-150 md:max-w-6xl"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="sr-only">Create Post</DialogTitle>
          <DialogDescription className="sr-only">
            Create a new post in the selected board.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {open ? (
            <Suspense fallback={<PostCreateFormFallback />}>
              <PostCreateForm />
            </Suspense>
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
