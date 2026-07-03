import { Button } from "@feeblo/ui/button";
import { ButtonGroup } from "@feeblo/ui/button-group";
import { Editor, EditorProvider } from "@feeblo/ui/editor";
import { GlobeIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createContext, type ReactNode, use, useState } from "react";

type CommentComposerState = {
  content: string;
  disabled: boolean;
  isPrivate: boolean;
  placeholder: string;
  resetKey: number;
};

type CommentComposerActions = {
  onContentChange: (content: string) => void;
  onSubmit?: () => void;
  onVisibilityChange: (isPrivate: boolean) => void;
};

type CommentComposerMeta = {
  privateLabel: string;
  publicLabel: string;
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
  content?: string;
  disabled?: boolean;
  isPrivate?: boolean;
  onContentChange?: (content: string) => void;
  onSubmit?: () => void;
  onVisibilityChange?: (isPrivate: boolean) => void;
  placeholder?: string;
  privateLabel?: string;
  publicLabel?: string;
  resetKey?: number;
};

function CommentComposerProvider({
  children,
  content = "",
  disabled = false,
  isPrivate = false,
  onContentChange,
  onSubmit,
  onVisibilityChange,
  placeholder,
  privateLabel = "Internal",
  publicLabel = "Public",
  resetKey = 0,
}: CommentComposerProviderProps) {
  return (
    <CommentComposerContext
      value={{
        actions: {
          onContentChange: onContentChange ?? (() => {}),
          onSubmit,
          onVisibilityChange: onVisibilityChange ?? (() => {}),
        },
        meta: { privateLabel, publicLabel },
        state: {
          content,
          disabled,
          isPrivate,
          placeholder:
            placeholder ??
            (isPrivate ? "Add an internal note..." : "Add a comment..."),
          resetKey,
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
    <EditorProvider key={state.resetKey}>
      <Editor
        onChange={(doc) => actions.onContentChange(doc)}
        placeholder={state.placeholder}
        readOnly={state.disabled}
      />
    </EditorProvider>
  );
}

function SubmitButton() {
  const { actions, state } = useCommentComposer();
  return (
    <Button
      aria-label={state.isPrivate ? "Switch to public" : "Switch to internal"}
      disabled={state.disabled}
      onClick={() => actions.onVisibilityChange(!state.isPrivate)}
      size="sm"
      type="button"
      variant={state.isPrivate ? "default" : "outline"}
    >
      <HugeiconsIcon
        icon={state.isPrivate ? ViewOffIcon : GlobeIcon}
        strokeWidth={2}
      />
    </Button>
  );
}

function VisibilitySwitcher() {
  const { actions, meta, state } = useCommentComposer();
  return (
    <Button
      disabled={state.disabled || !state.content}
      size="sm"
      type={actions.onSubmit ? "button" : "submit"}
      variant={state.isPrivate ? "default" : "outline"}
      {...(actions?.onSubmit
        ? {
            onClick: actions.onSubmit,
          }
        : {})}
    >
      {state.isPrivate
        ? `Comment ${meta.privateLabel}`
        : `Comment ${meta.publicLabel}`}
    </Button>
  );
}

function CommentComposerSubmit() {
  return (
    <div className="flex items-center justify-end pt-2">
      <ButtonGroup>
        <VisibilitySwitcher />
        <SubmitButton />
      </ButtonGroup>
    </div>
  );
}

type CommentComposerRootProps = {
  content?: string;
  disabled?: boolean;
  isPrivate?: boolean;
  onContentChange?: (content: string) => void;
  onSubmit?: (value: {
    content: string;
    isPrivate: boolean;
  }) => void | Promise<void>;
  onVisibilityChange?: (isPrivate: boolean) => void;
  placeholder?: string;
  privateLabel?: string;
  publicLabel?: string;
};

function CommentComposerComponent({
  content: externalContent,
  disabled,
  isPrivate: externalIsPrivate,
  onContentChange: externalOnContentChange,
  onSubmit,
  onVisibilityChange: externalOnVisibilityChange,
  placeholder,
  privateLabel,
  publicLabel,
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
      content={content}
      disabled={disabled}
      isPrivate={isPrivate}
      onContentChange={handleContentChange}
      onSubmit={onSubmit ? handleSubmit : undefined}
      onVisibilityChange={handleVisibilityChange}
      placeholder={placeholder}
      privateLabel={privateLabel}
      publicLabel={publicLabel}
      resetKey={resetKey}
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
