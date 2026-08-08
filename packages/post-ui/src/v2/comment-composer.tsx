import { Button } from "@feeblo/ui/button";
import { Editor } from "@feeblo/ui/editor";
import { EditorProvider } from "@feeblo/ui/editor/editor-store";
import { Toggle } from "@feeblo/ui/toggle";
import {
  Tooltip,
  TooltipPopup,
  TooltipProvider,
  TooltipTrigger,
} from "@feeblo/ui/tooltip";
import { cn } from "@feeblo/ui/utils";
import { CircleLockIcon, CircleUnlockIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createContext, type ReactNode, use, useState } from "react";

type CommentComposerState = {
  content: string;
  disabled: boolean;
  isPrivate: boolean;
  placeholder: string;
  resetKey: number;
  showVisibilityToggle: boolean;
};

type CommentComposerActions = {
  onCancel?: () => void;
  onContentChange: (content: string) => void;
  onSubmit?: () => void;
  onVisibilityChange: (isPrivate: boolean) => void;
};

type CommentComposerMeta = {
  cancelLabel: string;
  privateLabel: string;
  publicLabel: string;
  submitLabel?: string;
};

type CommentComposerContextValue = {
  actions: CommentComposerActions;
  meta: CommentComposerMeta;
  state: CommentComposerState;
};

const CommentComposerContext =
  createContext<CommentComposerContextValue | null>(null);

function useCommentComposer() {
  const value = use(CommentComposerContext);

  if (!value) {
    throw new Error("CommentComposer components must be used within Provider.");
  }

  return value;
}

export type CommentComposerProviderProps = {
  children?: ReactNode;
  cancelLabel?: string;
  content?: string;
  disabled?: boolean;
  isPrivate?: boolean;
  onCancel?: () => void;
  onContentChange?: (content: string) => void;
  onSubmit?: () => void;
  onVisibilityChange?: (isPrivate: boolean) => void;
  placeholder?: string;
  privateLabel?: string;
  publicLabel?: string;
  resetKey?: number;
  showVisibilityToggle?: boolean;
  submitLabel?: string;
};

function CommentComposerProvider({
  children,
  cancelLabel = "Cancel",
  content = "",
  disabled = false,
  isPrivate = false,
  onCancel,
  onContentChange,
  onSubmit,
  onVisibilityChange,
  placeholder,
  privateLabel = "Internal",
  publicLabel = "Public",
  resetKey = 0,
  showVisibilityToggle = true,
  submitLabel,
}: CommentComposerProviderProps) {
  return (
    <CommentComposerContext
      value={{
        actions: {
          onCancel,
          onContentChange: onContentChange ?? (() => {}),
          onSubmit,
          onVisibilityChange: onVisibilityChange ?? (() => {}),
        },
        meta: { cancelLabel, privateLabel, publicLabel, submitLabel },
        state: {
          content,
          disabled,
          isPrivate,
          placeholder:
            placeholder ??
            (isPrivate ? "Add an internal note..." : "Add a comment..."),
          resetKey,
          showVisibilityToggle,
        },
      }}
    >
      {children}
    </CommentComposerContext>
  );
}

function CommentComposerEditor() {
  const { actions, state } = useCommentComposer();

  return (
    <EditorProvider
      defaultValue={{ postContent: state.content }}
      key={state.resetKey}
    >
      <Editor
        className="text-sm"
        minimal
        onChange={(doc) => actions.onContentChange(doc)}
        placeholder={state.placeholder}
        readOnly={state.disabled}
      />
    </EditorProvider>
  );
}

function VisibilityToggle() {
  const { actions, meta, state } = useCommentComposer();

  const visibilityLabel = state.isPrivate
    ? meta.privateLabel
    : meta.publicLabel;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              aria-label={
                state.isPrivate ? "Switch to public" : "Switch to internal"
              }
              disabled={state.disabled}
              onPressedChange={(pressed) => actions.onVisibilityChange(pressed)}
              pressed={state.isPrivate}
              size="sm"
              variant="outline"
            >
              <HugeiconsIcon
                icon={state.isPrivate ? CircleLockIcon : CircleUnlockIcon}
                strokeWidth={2}
              />
            </Toggle>
          }
        />
        <TooltipPopup>{visibilityLabel}</TooltipPopup>
      </Tooltip>
    </TooltipProvider>
  );
}

function SubmitButton() {
  const { actions, meta, state } = useCommentComposer();
  return (
    <Button
      disabled={state.disabled}
      size="sm"
      type={actions.onSubmit ? "button" : "submit"}
      variant={state.isPrivate ? "default" : "outline"}
      {...(actions?.onSubmit
        ? {
            onClick: actions.onSubmit,
          }
        : {})}
    >
      {meta.submitLabel ??
        (state.isPrivate
          ? `Comment ${meta.privateLabel}`
          : `Comment ${meta.publicLabel}`)}
    </Button>
  );
}

function CommentComposerSubmit() {
  const { actions, meta, state } = useCommentComposer();

  return (
    <div
      className={cn(
        "flex items-center pt-2",
        state.showVisibilityToggle ? "justify-between" : "justify-end"
      )}
    >
      {state.showVisibilityToggle ? <VisibilityToggle /> : null}
      <div className="flex items-center gap-2">
        {actions.onCancel ? (
          <Button onClick={actions.onCancel} size="sm" variant="ghost">
            {meta.cancelLabel}
          </Button>
        ) : null}
        <SubmitButton />
      </div>
    </div>
  );
}

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
    ? (externalContent as string)
    : internalContent;
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
      <div className="rounded-md border border-border p-3">
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
