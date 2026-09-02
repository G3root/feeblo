import { useState } from "react";

import type { TPostStatusOption } from "./context";
import { CommentComposerEditor } from "./editor";
import { CommentComposerProvider } from "./provider";
import { CommentComposerSubmit } from "./submit";

export { type CommentComposerProviderProps } from "./provider";
export { type TPostStatusOption } from "./context";

type CommentComposerRootProps = {
  cancelLabel?: string;
  content?: string;
  disabled?: boolean;
  isPrivate?: boolean;
  onCancel?: () => void;
  onContentChange?: (content: string) => void;
  onSubmit?: (value: {
    content: string;
    isPrivate: boolean;
    statusUpdateId: string | null;
  }) => void | Promise<void>;
  onStatusUpdateIdChange?: (id: string | null) => void;
  onVisibilityChange?: (isPrivate: boolean) => void;
  placeholder?: string;
  privateLabel?: string;
  publicLabel?: string;
  showVisibilityToggle?: boolean;
  statusOptions?: readonly TPostStatusOption[];
  statusUpdateLabel?: string;
  submitLabel?: string;
};

function CommentComposerComponent({
  cancelLabel,
  content: externalContent,
  disabled,
  isPrivate: externalIsPrivate,
  onCancel,
  onContentChange: externalOnContentChange,
  onSubmit,
  onStatusUpdateIdChange: externalOnStatusUpdateIdChange,
  onVisibilityChange: externalOnVisibilityChange,
  placeholder,
  privateLabel,
  publicLabel,
  showVisibilityToggle,
  statusOptions,
  statusUpdateLabel,
  submitLabel,
}: CommentComposerRootProps) {
  const [internalContent, setInternalContent] = useState(externalContent ?? "");
  const [internalIsPrivate, setInternalIsPrivate] = useState(
    externalIsPrivate ?? false
  );
  const [internalStatusUpdateId, setInternalStatusUpdateId] = useState<
    string | null
  >(null);
  const [resetKey, setResetKey] = useState(0);
  // While a comment persists, the editor is disabled: the reset that clears
  // it only runs once the submit settles, so typing in that window would be
  // wiped by the clear (and, on the dashboard form path, race the
  // comment's optimistic insert).
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isContentControlled = externalContent !== undefined;
  const isVisibilityControlled = externalIsPrivate !== undefined;

  // SAFETY: the content is controlled only when the host passes a string.
  const content = isContentControlled
    ? (externalContent as string)
    : internalContent;
  // SAFETY: The upstream contract guarantees a boolean here.
  const isPrivate = isVisibilityControlled
    ? (externalIsPrivate as boolean)
    : internalIsPrivate;

  const handleContentChange = (doc: string) => {
    if (!isContentControlled) {
      setInternalContent(doc);
    }
    externalOnContentChange?.(doc);
  };

  const handleVisibilityChange = (checked: boolean) => {
    if (!isVisibilityControlled) {
      setInternalIsPrivate(checked);
    }
    externalOnVisibilityChange?.(checked);
  };

  const handleStatusUpdateIdChange = (id: string | null) => {
    setInternalStatusUpdateId(id);
    externalOnStatusUpdateIdChange?.(id);
  };

  const handleSubmit = async () => {
    if (!onSubmit || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({
        content,
        isPrivate,
        statusUpdateId: internalStatusUpdateId,
      });
      setResetKey((k) => k + 1);
      // Clear both the local state and the host callback so a chosen status
      // is never re-applied to the next comment.
      handleStatusUpdateIdChange(null);
      if (!isContentControlled) {
        setInternalContent("");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <CommentComposerProvider
      cancelLabel={cancelLabel}
      content={content}
      disabled={disabled || isSubmitting}
      isPrivate={isPrivate}
      onCancel={onCancel}
      onContentChange={handleContentChange}
      onSubmit={onSubmit ? handleSubmit : undefined}
      onStatusUpdateIdChange={handleStatusUpdateIdChange}
      onVisibilityChange={handleVisibilityChange}
      placeholder={placeholder}
      privateLabel={privateLabel}
      publicLabel={publicLabel}
      resetKey={resetKey}
      showVisibilityToggle={showVisibilityToggle}
      statusOptions={statusOptions}
      statusUpdateId={internalStatusUpdateId}
      statusUpdateLabel={statusUpdateLabel}
      submitLabel={submitLabel}
    >
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
