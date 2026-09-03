import { useIsomorphicLayoutEffect } from "@feeblo/ui/hooks/use-isomorphic-layout-effect";
import { useCallback, useMemo, useRef, type ReactNode } from "react";

import {
  CommentComposerContext,
  type CommentComposerActions,
  type CommentComposerContextValue,
  type TPostStatusOption,
} from "./context";
import { CommentComposerStoreProvider, useCommentComposerStore } from "./store";

// Stable identity for the default status options so the provider's
// contextValue memo isn't invalidated on renders where callers omit
// statusOptions (a fresh `[]` literal would break the memo's reference
// equality check every render).
const EMPTY_STATUS_OPTIONS: readonly TPostStatusOption[] = [];

export type CommentComposerSubmitValue = {
  content: string;
  isPrivate: boolean;
  statusUpdateId: string | null;
};

export type CommentComposerProviderProps = {
  children?: ReactNode;
  /** Display label of the picked on-behalf subject; null = session user. */
  authorDisplay?: string | null;
  /** Picker UI shown while `isAuthorMode` is on. */
  authorPicker?: ReactNode;
  cancelLabel?: string;
  /**
   * Controlled comment text. When omitted the composer keeps its own copy in
   * the store and clears it after submit.
   */
  content?: string;
  disabled?: boolean;
  isAuthorMode?: boolean;
  /** Controlled visibility; when omitted the composer keeps its own copy. */
  isPrivate?: boolean;
  onCancel?: () => void;
  onAuthorToggle?: (pressed: boolean) => void;
  onContentChange?: (content: string) => void;
  onSubmit?: (value: CommentComposerSubmitValue) => void | Promise<void>;
  onStatusUpdateIdChange?: (id: string | null) => void;
  onVisibilityChange?: (isPrivate: boolean) => void;
  placeholder?: string;
  privateLabel?: string;
  publicLabel?: string;
  /**
   * Controlled reset counter (bump it to clear the editor). When omitted the
   * composer bumps its own counter after a successful submit.
   */
  resetKey?: number;
  /** Whether the "comment as customer" toggle is rendered at all. */
  showAuthorToggle?: boolean;
  showVisibilityToggle?: boolean;
  statusUpdateLabel?: string;
  /** Controlled status update; when omitted the composer keeps its own copy. */
  statusUpdateId?: string | null;
  statusOptions?: readonly TPostStatusOption[];
  submitLabel?: string;
};

export function CommentComposerProvider(props: CommentComposerProviderProps) {
  const { content, isPrivate } = props;

  return (
    <CommentComposerStoreProvider
      defaultValue={{ content: content ?? "", isPrivate: isPrivate ?? false }}
    >
      <CommentComposerController {...props} />
    </CommentComposerStoreProvider>
  );
}

/**
 * Wires the store to the host callbacks. It owns no React state — the store
 * is the single source of truth for mutable composer state, and the context
 * value below only carries prop-derived data plus stable action closures, so
 * host re-renders (and keystrokes) don't re-render composer consumers.
 */
function CommentComposerController(props: CommentComposerProviderProps) {
  const store = useCommentComposerStore();
  const {
    authorDisplay = null,
    authorPicker = null,
    cancelLabel = "Cancel",
    children,
    content,
    disabled = false,
    isAuthorMode = false,
    isPrivate,
    placeholder,
    privateLabel = "Internal",
    publicLabel = "Public",
    resetKey,
    showAuthorToggle = false,
    showVisibilityToggle = true,
    statusUpdateLabel = "Comment as status update",
    statusUpdateId,
    statusOptions = EMPTY_STATUS_OPTIONS,
    submitLabel,
  } = props;

  // SAFETY: only read at event time. The ref lets the memoized actions and
  // the effects below stay referentially stable while the host re-renders
  // with fresh (inline) callbacks — otherwise every host render would
  // re-render the whole composer through context.
  const latest = useRef(props);
  latest.current = props;

  // Mirror controlled values into the store. Guarded so a render that didn't
  // change a value never dispatches; running in a layout effect keeps the
  // store consistent before the browser paints (no flicker on toggles).
  useIsomorphicLayoutEffect(() => {
    if (content !== undefined && content !== store.get().context.content) {
      store.send({ type: "contentChanged", content });
    }
  }, [content, store]);

  useIsomorphicLayoutEffect(() => {
    if (
      isPrivate !== undefined &&
      isPrivate !== store.get().context.isPrivate
    ) {
      store.send({ type: "visibilityChanged", isPrivate });
    }
  }, [isPrivate, store]);

  useIsomorphicLayoutEffect(() => {
    if (
      statusUpdateId !== undefined &&
      statusUpdateId !== store.get().context.statusUpdateId
    ) {
      store.send({ type: "statusUpdateIdChanged", statusUpdateId });
    }
  }, [statusUpdateId, store]);

  useIsomorphicLayoutEffect(() => {
    if (resetKey !== undefined && resetKey !== store.get().context.resetKey) {
      store.send({
        type: "resetKeyChanged",
        clearContent: latest.current.content === undefined,
        resetKey,
      });
    }
  }, [resetKey, store]);

  const handleSubmit = useCallback(async () => {
    const { onSubmit } = latest.current;

    if (!onSubmit) {
      return;
    }

    const { context } = store.get();

    if (context.isSubmitting) {
      return;
    }

    store.send({ type: "submitStarted" });

    try {
      await onSubmit({
        content: context.content,
        isPrivate: context.isPrivate,
        statusUpdateId: context.statusUpdateId,
      });

      store.send({
        type: "submitted",
        clearContent: latest.current.content === undefined,
      });
      // Clear the host's status update too so a chosen status is never
      // re-applied to the next comment.
      latest.current.onStatusUpdateIdChange?.(null);
    } finally {
      store.send({ type: "submitSettled" });
    }
  }, [store]);

  const hasSubmit = props.onSubmit !== undefined;
  const hasCancel = props.onCancel !== undefined;

  const actions = useMemo<CommentComposerActions>(() => {
    const composed: CommentComposerActions = {
      onAuthorToggle: (pressed: boolean) =>
        latest.current.onAuthorToggle?.(pressed),
      onContentChange: (doc: string) => {
        // The store owns the text only when the host doesn't pass `content`.
        if (latest.current.content === undefined) {
          store.send({ type: "contentChanged", content: doc });
        }
        latest.current.onContentChange?.(doc);
      },
      onStatusUpdateIdChange: (id: string | null) => {
        if (latest.current.statusUpdateId === undefined) {
          store.send({ type: "statusUpdateIdChanged", statusUpdateId: id });
        }
        latest.current.onStatusUpdateIdChange?.(id);
      },
      onVisibilityChange: (isPrivate: boolean) => {
        if (latest.current.isPrivate === undefined) {
          store.send({ type: "visibilityChanged", isPrivate });
        }
        latest.current.onVisibilityChange?.(isPrivate);
      },
    };

    // Action closures exist only when the host opted in, so consumers can
    // detect them (the submit bar shows the cancel button only when an
    // onCancel handler was provided).
    if (hasCancel) {
      composed.onCancel = () => latest.current.onCancel?.();
    }

    if (hasSubmit) {
      composed.onSubmit = handleSubmit;
    }

    return composed;
  }, [handleSubmit, hasCancel, hasSubmit, store]);

  const contextValue = useMemo<CommentComposerContextValue>(
    () => ({
      actions,
      meta: {
        cancelLabel,
        privateLabel,
        publicLabel,
        statusUpdateLabel,
        submitLabel,
      },
      state: {
        authorDisplay,
        authorPicker,
        disabled,
        isAuthorMode,
        placeholder,
        showAuthorToggle,
        showVisibilityToggle,
        statusOptions,
      },
    }),
    [
      actions,
      authorDisplay,
      authorPicker,
      cancelLabel,
      disabled,
      isAuthorMode,
      placeholder,
      privateLabel,
      publicLabel,
      showAuthorToggle,
      showVisibilityToggle,
      statusOptions,
      statusUpdateLabel,
      submitLabel,
    ]
  );

  return (
    <CommentComposerContext value={contextValue}>
      {children}
    </CommentComposerContext>
  );
}
