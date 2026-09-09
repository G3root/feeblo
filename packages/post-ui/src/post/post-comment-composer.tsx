import { Alert, AlertDescription, AlertTitle } from "@feeblo/ui/alert";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { MessageLock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type FormEvent, type ReactNode, useCallback, useState } from "react";

import { m } from "../paraglide/messages.js";
import { CommentComposerField, useCommentForm } from "../v2/forms/comment-form";
import { usePostCollectionData } from "../v2/post-page-context";

type TCommentVisibility = "PUBLIC" | "INTERNAL";

type PostCommentComposerProps = {
  disabledReason?: string;
  defaultVisibility?: TCommentVisibility;
  showVisibilityPicker?: boolean;
};

export function PostCommentComposer({
  disabledReason = m.elegant_low_mule(),
  defaultVisibility = "PUBLIC",
  showVisibilityPicker = false,
}: PostCommentComposerProps) {
  const { data: session } = useAuthState();
  const { isLocked, isMember, organizationId } = usePostCollectionData();
  // Status updates move the post, so the picker is a manager+ privilege
  // (posts.status) everywhere — mirroring the post editor and backend policy.
  const { allowed: canStatusUpdate } = usePolicy(
    hasPermission(organizationId, "posts.status")
  );
  const disabled = isLocked || !session;
  const showStatusUpdate = isMember && canStatusUpdate;
  const [editorKey, setEditorKey] = useState(0);

  const form = useCommentForm({
    defaultValues: {
      visibility: defaultVisibility,
    },
    setEditorKey,
    showVisibilityPicker,
  });

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      event.stopPropagation();
      form.handleSubmit();
    },
    [form]
  );

  return (
    <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
      <CommentComposerField
        disabled={disabled}
        form={form}
        resetKey={editorKey}
        showStatusUpdate={showStatusUpdate}
        showVisibilityToggle={isMember}
      />
      {isLocked && (
        <Alert variant="info">
          <HugeiconsIcon icon={MessageLock01Icon} />
          <AlertTitle>{m.heavy_early_bear()}</AlertTitle>
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
  description = m.warm_patient_crab(),
  isAuthenticated,
  title = m.top_bald_alpaca(),
}: PostCommentGuestPromptProps) {
  if (isAuthenticated) {
    return null;
  }

  return (
    <div className="border-border/80 rounded-xl border px-4 py-4">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      <div className="mt-3">{action}</div>
    </div>
  );
}
