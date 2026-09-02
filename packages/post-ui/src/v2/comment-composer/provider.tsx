import { type ReactNode, useMemo } from "react";

import {
  CommentComposerContext,
  type CommentComposerContextValue,
  type TPostStatusOption,
} from "./context";

export type CommentComposerProviderProps = {
  children?: ReactNode;
  cancelLabel?: string;
  content?: string;
  disabled?: boolean;
  isPrivate?: boolean;
  onCancel?: () => void;
  onContentChange?: (content: string) => void;
  onSubmit?: () => void;
  onStatusUpdateIdChange?: (id: string | null) => void;
  onVisibilityChange?: (isPrivate: boolean) => void;
  placeholder?: string;
  privateLabel?: string;
  publicLabel?: string;
  resetKey?: number;
  showVisibilityToggle?: boolean;
  statusUpdateLabel?: string;
  statusUpdateId?: string | null;
  statusOptions?: readonly TPostStatusOption[];
  submitLabel?: string;
};

export function CommentComposerProvider({
  children,
  cancelLabel = "Cancel",
  content = "",
  disabled = false,
  isPrivate = false,
  onCancel,
  onContentChange,
  onSubmit,
  onStatusUpdateIdChange,
  onVisibilityChange,
  placeholder,
  privateLabel = "Internal",
  publicLabel = "Public",
  resetKey = 0,
  showVisibilityToggle = true,
  statusUpdateLabel = "Comment as status update",
  statusUpdateId = null,
  statusOptions = [],
  submitLabel,
}: CommentComposerProviderProps) {
  const contextValue = useMemo<CommentComposerContextValue>(
    () => ({
      actions: {
        onCancel,
        onContentChange: onContentChange ?? (() => {}),
        onSubmit,
        onStatusUpdateIdChange: onStatusUpdateIdChange ?? (() => {}),
        onVisibilityChange: onVisibilityChange ?? (() => {}),
      },
      meta: {
        cancelLabel,
        privateLabel,
        publicLabel,
        statusUpdateLabel,
        submitLabel,
      },
      state: {
        content,
        disabled,
        isPrivate,
        placeholder:
          placeholder ??
          (isPrivate ? "Add an internal note..." : "Add a comment..."),
        resetKey,
        showVisibilityToggle,
        statusUpdateId,
        statusOptions,
      },
    }),
    [
      cancelLabel,
      content,
      disabled,
      isPrivate,
      onCancel,
      onContentChange,
      onSubmit,
      onStatusUpdateIdChange,
      onVisibilityChange,
      placeholder,
      privateLabel,
      publicLabel,
      resetKey,
      showVisibilityToggle,
      statusUpdateLabel,
      statusUpdateId,
      statusOptions,
      submitLabel,
    ]
  );

  return (
    <CommentComposerContext value={contextValue}>
      {children}
    </CommentComposerContext>
  );
}
