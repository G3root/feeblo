import { useState } from "react";

import { CommentComposerEditor } from "./editor";
import { CommentComposerProvider } from "./provider";
import { CommentComposerSubmit } from "./submit";

export { type CommentComposerProviderProps } from "./provider";

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
  }) => void | Promise<void>;
  onVisibilityChange?: (isPrivate: boolean) => void;
  placeholder?: string;
  privateLabel?: string;
  publicLabel?: string;
  showVisibilityToggle?: boolean;
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
  onVisibilityChange: externalOnVisibilityChange,
  placeholder,
  privateLabel,
  publicLabel,
  showVisibilityToggle,
  submitLabel,
}: CommentComposerRootProps) {
  const [internalContent, setInternalContent] = useState(externalContent ?? "");
  const [internalIsPrivate, setInternalIsPrivate] = useState(
    externalIsPrivate ?? false
  );
  const [resetKey, setResetKey] = useState(0);

  const isContentControlled = externalContent !== undefined;
  const isVisibilityControlled = externalIsPrivate !== undefined;

  const content = isContentControlled
    // SAFETY: The upstream contract guarantees a string here.
    ? (/* SAFETY: the content is controlled only when the host passes a string. */
      externalContent as string)
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

  const handleSubmit = async () => {
    if (!onSubmit) {
      return;
    }
    await onSubmit({ content, isPrivate });
    setResetKey((k) => k + 1);
    if (!isContentControlled) {
      setInternalContent("");
    }
  };

  return (
    <CommentComposerProvider
      cancelLabel={cancelLabel}
      content={content}
      disabled={disabled}
      isPrivate={isPrivate}
      onCancel={onCancel}
      onContentChange={handleContentChange}
      onSubmit={onSubmit ? handleSubmit : undefined}
      onVisibilityChange={handleVisibilityChange}
      placeholder={placeholder}
      privateLabel={privateLabel}
      publicLabel={publicLabel}
      resetKey={resetKey}
      showVisibilityToggle={showVisibilityToggle}
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
