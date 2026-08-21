import { useState } from "react";
import type { ReactNode } from "react";

import { AuthorToggle } from "./author-toggle";
import { CommentComposerEditor } from "./editor";
import { CommentComposerProvider } from "./provider";
import { CommentComposerSubmit } from "./submit";

export { type CommentComposerProviderProps } from "./provider";

type CommentComposerRootProps = {
  authorDisplay?: string | null;
  authorPicker?: ReactNode;
  cancelLabel?: string;
  content?: string;
  disabled?: boolean;
  isAuthorMode?: boolean;
  isPrivate?: boolean;
  onCancel?: () => void;
  onAuthorToggle?: (pressed: boolean) => void;
  onContentChange?: (content: string) => void;
  onSubmit?: (value: {
    content: string;
    isPrivate: boolean;
  }) => void | Promise<void>;
  onVisibilityChange?: (isPrivate: boolean) => void;
  placeholder?: string;
  privateLabel?: string;
  publicLabel?: string;
  showAuthorToggle?: boolean;
  showVisibilityToggle?: boolean;
  submitLabel?: string;
};

function CommentComposerComponent({
  authorDisplay,
  authorPicker,
  cancelLabel,
  content: externalContent,
  disabled,
  isAuthorMode,
  isPrivate: externalIsPrivate,
  onCancel,
  onAuthorToggle,
  onContentChange: externalOnContentChange,
  onSubmit,
  onVisibilityChange: externalOnVisibilityChange,
  placeholder,
  privateLabel,
  publicLabel,
  showAuthorToggle,
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
      authorDisplay={authorDisplay}
      authorPicker={authorPicker}
      cancelLabel={cancelLabel}
      content={content}
      disabled={disabled}
      isAuthorMode={isAuthorMode}
      isPrivate={isPrivate}
      onCancel={onCancel}
      onAuthorToggle={onAuthorToggle}
      onContentChange={handleContentChange}
      onSubmit={onSubmit ? handleSubmit : undefined}
      onVisibilityChange={handleVisibilityChange}
      placeholder={placeholder}
      privateLabel={privateLabel}
      publicLabel={publicLabel}
      resetKey={resetKey}
      showAuthorToggle={showAuthorToggle}
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
  AuthorToggle,
  Editor: CommentComposerEditor,
  Provider: CommentComposerProvider,
  Submit: CommentComposerSubmit,
});
