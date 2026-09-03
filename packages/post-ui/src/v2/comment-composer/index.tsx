import { AuthorToggle } from "./author-toggle";
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
 * The composer's chrome, styled like `@feeblo/ui`'s Input/Textarea wrappers:
 * `border-input` border, the inner top-light shadow, and the dark-mode
 * `input/32` surface. No focus ring — focus is left to the editor itself.
 */
export const commentComposerBoxClassName =
  "border-input bg-background text-foreground dark:bg-input/32 relative flex w-full flex-col rounded-lg border p-3 shadow-xs/5 transition-shadow not-dark:bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]";

/**
 * All mutable composer state lives in the provider's store; the root only
 * supplies the default layout.
 */
function CommentComposerComponent(props: CommentComposerProviderProps) {
  return (
    <CommentComposerProvider {...props}>
      <div className={commentComposerBoxClassName}>
        <CommentComposerEditor />
        <CommentComposerSubmit />
      </div>
    </CommentComposerProvider>
  );
}

export const CommentComposer = Object.assign(CommentComposerComponent, {
  AuthorToggle,
  Editor: CommentComposerEditor,
  Provider: CommentComposerProvider,
  Submit: CommentComposerSubmit,
});
