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
  return <DialogPanel>Loading post form…</DialogPanel>;
}

export function PostCreateDialog() {
  const store = usePostCreateDialogContext();
  const open = useSelector(store, (state) => state.context.open);
  return (
    <Dialog onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <DialogPopup className="w-full max-w-187.5 md:min-h-150">
        <DialogHeader>
          <DialogTitle>Create Post</DialogTitle>
          <DialogDescription>
            Create a new post in the selected board.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <Suspense fallback={<PostCreateFormFallback />}>
            <PostCreateForm />
          </Suspense>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}
