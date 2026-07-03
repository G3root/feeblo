import { Button } from "@feeblo/ui/button";
import { Editor, EditorProvider } from "@feeblo/ui/editor";
import { createContext, type ReactNode, use, useRef, useState } from "react";
import { usePostCollectionData } from "./post-collection";
import { usePostCollections } from "./providers/post-collections-provider";

type PostEditorState = {
  content: string;
  disabled: boolean;
  placeholder: string;
  resetKey: number;
};

type PostEditorActions = {
  onContentChange: (content: string) => void;
  onSubmit: () => void | Promise<void>;
};

type PostEditorMeta = {
  submitLabel: string;
};

type PostEditorContextValue = {
  actions: PostEditorActions;
  meta: PostEditorMeta;
  state: PostEditorState;
};

const PostEditorContext = createContext<PostEditorContextValue | null>(null);

function usePostEditor() {
  const value = use(PostEditorContext);

  if (!value) {
    throw new Error("PostEditor components must be used within Provider.");
  }

  return value;
}

type PostEditorProviderProps = {
  children?: ReactNode;
  content?: string;
  disabled?: boolean;
  onContentChange?: (content: string) => void;
  onSubmit?: () => void | Promise<void>;
  placeholder?: string;
  resetKey?: number;
  submitLabel?: string;
};

function PostEditorProvider({
  children,
  content = "",
  disabled = false,
  onContentChange,
  onSubmit = () => {},
  placeholder,
  resetKey = 0,
  submitLabel = "Publish",
}: PostEditorProviderProps) {
  return (
    <PostEditorContext
      value={{
        actions: {
          onContentChange: onContentChange ?? (() => {}),
          onSubmit,
        },
        meta: { submitLabel },
        state: {
          content,
          disabled,
          placeholder:
            placeholder ?? "Type '/' for commands or start typing...",
          resetKey,
        },
      }}
    >
      {children}
    </PostEditorContext>
  );
}

function PostEditorEditor() {
  const { actions, state } = usePostEditor();

  return (
    <EditorProvider
      defaultValue={{ postContent: state.content }}
      key={state.resetKey}
    >
      <Editor
        onChange={(doc) => actions.onContentChange(doc)}
        placeholder={state.placeholder}
        readOnly={state.disabled}
      />
    </EditorProvider>
  );
}

function PostEditorSubmit() {
  const { actions, meta, state } = usePostEditor();

  return (
    <div className="flex items-center justify-end pt-2">
      <Button
        disabled={state.disabled}
        onClick={actions.onSubmit}
        size="sm"
        type="button"
      >
        {meta.submitLabel}
      </Button>
    </div>
  );
}

type PostEditorRootProps = {
  children?: ReactNode;
  content?: string;
  disabled?: boolean;
  onContentChange?: (content: string) => void;
  onSubmit?: (value: { content: string }) => void | Promise<void>;
  placeholder?: string;
  submitLabel?: string;
};

function PostEditorComponent({
  children,
  content: externalContent,
  disabled,
  onContentChange: externalOnContentChange,
  onSubmit = () => {},
  placeholder,
  submitLabel,
}: PostEditorRootProps) {
  const [internalContent, setInternalContent] = useState(externalContent ?? "");
  const [resetKey, setResetKey] = useState(0);
  const contentRef = useRef(externalContent ?? "");

  const isContentControlled = externalContent !== undefined;

  const content = isContentControlled
    ? (externalContent as string)
    : internalContent;

  contentRef.current = content;

  const handleContentChange = (doc: string) => {
    contentRef.current = doc;
    if (!isContentControlled) {
      setInternalContent(doc);
    }
    externalOnContentChange?.(doc);
  };

  const handleSubmit = async () => {
    await onSubmit({ content: contentRef.current });
    setResetKey((k) => k + 1);
    if (!isContentControlled) {
      setInternalContent("");
    }
    contentRef.current = "";
  };

  return (
    <PostEditorProvider
      content={content}
      disabled={disabled}
      onContentChange={handleContentChange}
      onSubmit={handleSubmit}
      placeholder={placeholder}
      resetKey={resetKey}
      submitLabel={submitLabel}
    >
      <div className="p-3">
        <PostEditorEditor />
        {children}
      </div>
    </PostEditorProvider>
  );
}

export const PostEditor = Object.assign(PostEditorComponent, {
  Editor: PostEditorEditor,
  Provider: PostEditorProvider,
  Submit: PostEditorSubmit,
});

export function PostContentUpdateInput() {
  const {
    collections: { postCollection },
  } = usePostCollections();
  const { canManagePost, isLocked, post } = usePostCollectionData();

  const disabled = isLocked || !canManagePost;

  return (
    <PostEditor
      content={post.content}
      disabled={disabled}
      onSubmit={async ({ content }) => {
        if (content !== "") {
          const tx = postCollection.update(post.id, (draft) => {
            draft.content = content;
          });

          await tx.isPersisted.promise;
        }
      }}
      submitLabel="Update"
    >
      <PostEditor.Submit />
    </PostEditor>
  );
}
