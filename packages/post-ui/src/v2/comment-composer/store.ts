import { createStore, createStoreContext } from "@feeblo/web-shared/xstate";
import { useSelector } from "@xstate/store-react";

export type CommentComposerStoreContext = {
  /** Comment text; the store owns it unless the host passes a controlled `content`. */
  content: string;
  isPrivate: boolean;
  /** True while a composer-driven submit is in flight; disables the composer. */
  isSubmitting: boolean;
  /** Bumped after a successful submit so the editor can clear itself in place. */
  resetKey: number;
  /** Post status (FK id) this comment moves the post to; null = plain comment. */
  statusUpdateId: string | null;
};

export type CommentComposerStoreDefaultValue = {
  content?: string;
  isPrivate?: boolean;
};

const createCommentComposerStore = (
  defaultValue?: CommentComposerStoreDefaultValue
) =>
  createStore({
    // SAFETY: The assertion widens the literal `null`s to their union types.
    context: {
      content: defaultValue?.content ?? "",
      isPrivate: defaultValue?.isPrivate ?? false,
      isSubmitting: false,
      resetKey: 0,
      statusUpdateId: null,
    } as CommentComposerStoreContext,
    on: {
      contentChanged: (context, event: { content: string }) => ({
        ...context,
        content: event.content,
      }),
      visibilityChanged: (context, event: { isPrivate: boolean }) => ({
        ...context,
        isPrivate: event.isPrivate,
      }),
      statusUpdateIdChanged: (
        context,
        event: { statusUpdateId: string | null }
      ) => ({
        ...context,
        statusUpdateId: event.statusUpdateId,
      }),
      // A host-driven reset (resetKey prop) also clears the store-owned text
      // so a stale draft can never be re-submitted after the editor clears.
      resetKeyChanged: (context, event: { clearContent: boolean; resetKey: number }) => ({
        ...context,
        resetKey: event.resetKey,
        ...(event.clearContent && { content: "" }),
      }),
      submitStarted: (context) => ({ ...context, isSubmitting: true }),
      submitSettled: (context) => ({ ...context, isSubmitting: false }),
      // Post-submit reset: bumps the editor-reset counter, drops the one-shot
      // status update, and (only when the store owns the text) clears it.
      submitted: (context, event: { clearContent: boolean }) => ({
        ...context,
        resetKey: context.resetKey + 1,
        statusUpdateId: null,
        ...(event.clearContent && { content: "" }),
      }),
    },
  });

export const [CommentComposerStoreProvider, useCommentComposerStore] =
  createStoreContext<
    ReturnType<typeof createCommentComposerStore>,
    CommentComposerStoreDefaultValue
  >({
    createStore: createCommentComposerStore,
    hookName: "useCommentComposerStore",
    name: "CommentComposerStoreContext",
    providerName: "CommentComposerStoreProvider",
  });

/**
 * Selects a slice of the composer store. Components re-render only when the
 * selected value changes, not on every store update — e.g. typing dispatches
 * `contentChanged`, which re-renders nothing since no component selects
 * `content` (the editor captures its initial text once at mount).
 */
export function useCommentComposerState<T>(
  selector: (context: CommentComposerStoreContext) => T
): T {
  const store = useCommentComposerStore();

  return useSelector(store, (state) => selector(state.context));
}
