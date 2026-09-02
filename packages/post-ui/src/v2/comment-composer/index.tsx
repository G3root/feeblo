import { CommentComposerEditor } from "./editor";
import {
  CommentComposerProvider,
  type CommentComposerProviderProps,
} from "./provider";
import { CommentComposerSubmit } from "./submit";

export { type TPostStatusOption } from "./context";
export {
  CommentComposerProvider,
  type CommentComposerProviderProps,
  type CommentComposerSubmitValue,
} from "./provider";

/**
 * All mutable composer state lives in the provider's store; the root only
 * supplies the default layout.
 */
function CommentComposerComponent(props: CommentComposerProviderProps) {
  return (
    <CommentComposerProvider {...props}>
      <div className="border-border rounded-md border p-3">
        <CommentComposerEditor />
        <CommentComposerSubmit />
      </div>
    </CommentComposerProvider>
  );
}

export const CommentComposer = Object.assign(CommentComposerComponent, {
  Editor: CommentComposerEditor,
  Provider: CommentComposerProvider,
  Submit: CommentComposerSubmit,
});
