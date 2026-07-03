import { Alert, AlertDescription, AlertTitle } from "@feeblo/ui/alert";
import { MessageLock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useState } from "react";
import { CommentComposerField, useCommentForm } from "../v2/forms/comment-form";

type TCommentVisibility = "PUBLIC" | "INTERNAL";

type PostCommentComposerProps = {
  disabled?: boolean;
  disabledReason?: string;
  defaultVisibility?: TCommentVisibility;
  showVisibilityPicker?: boolean;
  postId: string;
};

export function PostCommentComposer({
  disabled = false,
  disabledReason = "Comments are locked for this post.",
  defaultVisibility = "PUBLIC",
  showVisibilityPicker = false,
  postId,
}: PostCommentComposerProps) {
  const [editorKey, setEditorKey] = useState(0);

  const form = useCommentForm({
    defaultValues: {
      visibility: defaultVisibility,
    },
    postId,
    setEditorKey,
    showVisibilityPicker,
  });

  return (
    <form
      className="mt-3 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      <CommentComposerField
        disabled={disabled}
        form={form}
        resetKey={editorKey}
      />
      {disabled && (
        <Alert variant="info">
          <HugeiconsIcon icon={MessageLock01Icon} />
          <AlertTitle>Comments locked</AlertTitle>
          <AlertDescription>{disabledReason}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}

type PostCommentGuestPromptProps = {
  action: ReactNode;
  description?: string;
  isAuthenticated: boolean;
  title?: string;
};

export function PostCommentGuestPrompt({
  action,
  description = "Sign in to leave a comment or react to this post.",
  isAuthenticated,
  title = "Join the discussion",
}: PostCommentGuestPromptProps) {
  if (isAuthenticated) {
    return null;
  }

  return (
    <div className="rounded-xl border border-border/80 px-4 py-4">
      <p className="font-medium text-sm">{title}</p>
      <p className="mt-1 text-muted-foreground text-sm">{description}</p>
      <div className="mt-3">{action}</div>
    </div>
  );
}
