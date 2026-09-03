import { Button } from "@feeblo/ui/button";
import { Editor, finalizeEditorContent } from "@feeblo/ui/editor";
import { EditorProvider } from "@feeblo/ui/editor/editor-store";
import { anchoredToastManager, toastManager } from "@feeblo/ui/toast";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import { createOptimisticAction } from "@tanstack/react-db";
import {
  createContext,
  memo,
  type ReactNode,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ContentSkeleton } from "./content-skeleton";
import { usePostCollectionData } from "./post-page-context";
import { usePostCollections } from "./providers/post-collections-provider";
import { usePostDetail } from "./use-post-detail";

type PostEditorState = {
  disabled: boolean;
  editorScope: string;
  organizationId?: string;
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

type PostEditorInitialContent = {
  value: string;
};

const PostEditorInitialContentContext =
  createContext<PostEditorInitialContent | null>(null);

const DEFAULT_PLACEHOLDER = "Type '/' for commands or start typing...";
const noop = () => undefined;

function usePostEditor() {
  const value = use(PostEditorContext);

  if (!value) {
    throw new Error("PostEditor components must be used within Provider.");
  }

  return value;
}

function usePostEditorInitialContent() {
  const value = use(PostEditorInitialContentContext);

  if (!value) {
    throw new Error("PostEditor components must be used within Provider.");
  }

  return value.value;
}

function PostEditorInitialContentProvider({
  children,
  content,
  resetKey,
}: {
  children?: ReactNode;
  content: string;
  resetKey: number;
}) {
  const [initialContent, setInitialContent] = useState(() => ({
    value: content,
  }));
  const [prevResetKey, setPrevResetKey] = useState(resetKey);

  // Refresh the editor's initial content when the editor is reset. This is
  // done by syncing state during render instead of remounting this provider
  // with a changing `key`: the old approach also unmounted the children (e.g.
  // the Submit button), which nulled their refs and detached elements that
  // anchored toasts were about to be positioned against.
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setInitialContent({ value: content });
  }

  return (
    <PostEditorInitialContentContext value={initialContent}>
      {children}
    </PostEditorInitialContentContext>
  );
}

type PostEditorProviderProps = {
  children?: ReactNode;
  content?: string;
  disabled?: boolean;
  editorScope?: string;
  organizationId?: string;
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
  editorScope: providedEditorScope,
  organizationId,
  onContentChange,
  onSubmit = noop,
  placeholder,
  resetKey = 0,
  submitLabel = "Publish",
}: PostEditorProviderProps) {
  const onContentChangeRef = useRef(onContentChange);
  const onSubmitRef = useRef(onSubmit);
  const [generatedEditorScope] = useState(() => crypto.randomUUID());
  const editorScope = providedEditorScope ?? generatedEditorScope;

  // Keep the latest callbacks reachable from the memoized `actions` without
  // writing refs during render (render must stay pure). Effects flush before
  // any event handler runs, so the refs are always current when used.
  useEffect(() => {
    onContentChangeRef.current = onContentChange;
    onSubmitRef.current = onSubmit;
  }, [onContentChange, onSubmit]);

  const actions = useMemo<PostEditorActions>(
    () => ({
      onContentChange: (nextContent) => {
        onContentChangeRef.current?.(nextContent);
      },
      onSubmit: () => onSubmitRef.current(),
    }),
    []
  );
  const state = useMemo<PostEditorState>(
    () => ({
      disabled,
      editorScope,
      organizationId,
      placeholder: placeholder ?? DEFAULT_PLACEHOLDER,
      resetKey,
    }),
    [disabled, editorScope, organizationId, placeholder, resetKey]
  );
  const meta = useMemo<PostEditorMeta>(() => ({ submitLabel }), [submitLabel]);
  const contextValue = useMemo<PostEditorContextValue>(
    () => ({ actions, meta, state }),
    [actions, meta, state]
  );

  return (
    <PostEditorInitialContentProvider content={content} resetKey={resetKey}>
      <PostEditorContext value={contextValue}>{children}</PostEditorContext>
    </PostEditorInitialContentProvider>
  );
}

const PostEditorEditor = memo(function PostEditorEditor() {
  const { actions, state } = usePostEditor();
  const initialContent = usePostEditorInitialContent();

  return (
    <EditorProvider
      defaultValue={{
        deferUploads: true,
        editorScope: state.editorScope,
        organizationId: state.organizationId,
        postContent: initialContent,
      }}
      key={state.resetKey}
    >
      <Editor
        deferUploads
        editorScope={state.editorScope}
        onChange={actions.onContentChange}
        organizationId={state.organizationId}
        placeholder={state.placeholder}
        readOnly={state.disabled}
      />
    </EditorProvider>
  );
});

const ANCHORED_SAVE_TOAST_ID = "post-save";
const PostEditorSubmit = memo(function PostEditorSubmit() {
  const { actions, meta, state } = usePostEditor();
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="flex items-center justify-end pt-2">
      <Button
        aria-label="Save"
        disabled={state.disabled}
        onClick={async () => {
          // Capture the anchor synchronously: awaiting the submit can unmount
          // or replace the button, which would null `saveButtonRef.current`
          // (or detach the element) before the toast is added.
          const anchor = saveButtonRef.current;
          if (!anchor) {
            return;
          }

          try {
            await actions.onSubmit();

            anchoredToastManager.add({
              id: ANCHORED_SAVE_TOAST_ID,
              data: {
                tooltipStyle: true,
              },
              positionerProps: {
                anchor,
                sideOffset: 8,
              },
              timeout: 2000,
              title: `${meta.submitLabel} successful`,
            });
          } catch {
            // Failure feedback is surfaced by the onSubmit handler.
          }
        }}
        ref={saveButtonRef}
        size="sm"
        type="button"
      >
        {meta.submitLabel}
      </Button>
    </div>
  );
});

type PostEditorRootProps = {
  children?: ReactNode;
  content?: string;
  disabled?: boolean;
  editorScope?: string;
  existingAssetIds?: readonly string[];
  organizationId?: string;
  onContentChange?: (content: string) => void;
  onSubmit?: (value: {
    assetIds: string[];
    content: string;
  }) => void | Promise<void>;
  placeholder?: string;
  submitLabel?: string;
};

function PostEditorComponent({
  children,
  content: externalContent,
  disabled,
  editorScope: providedEditorScope,
  existingAssetIds = [],
  organizationId,
  onContentChange: externalOnContentChange,
  onSubmit = noop,
  placeholder,
  submitLabel,
}: PostEditorRootProps) {
  const [internalContent, setInternalContent] = useState(externalContent ?? "");
  const [resetKey, setResetKey] = useState(0);
  const contentRef = useRef(externalContent ?? "");
  const [generatedEditorScope] = useState(() => crypto.randomUUID());
  const editorScope = providedEditorScope ?? generatedEditorScope;

  const isContentControlled = externalContent !== undefined;

  // SAFETY: the content is controlled only when the host passes a string.
  const content = isContentControlled
    ? (externalContent as string)
    : internalContent;

  // Sync the latest content into the ref after render; the ref is only ever
  // read from event handlers, which run after effects have flushed.
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  const handleContentChange = (doc: string) => {
    contentRef.current = doc;
    if (!isContentControlled) {
      setInternalContent(doc);
    }
    externalOnContentChange?.(doc);
  };

  const handleSubmit = async () => {
    const finalized = await finalizeEditorContent(
      contentRef.current,
      organizationId,
      { assetIds: existingAssetIds, scope: editorScope }
    );
    await onSubmit({
      assetIds: finalized.assetIds,
      content: finalized.content,
    });
    finalized.commit();
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
      editorScope={editorScope}
      onContentChange={handleContentChange}
      onSubmit={handleSubmit}
      organizationId={organizationId}
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
    collections: { postCollection, postDetailCollection },
    organizationId,
  } = usePostCollections();
  const { canManagePost, isLocked, post, pageType } = usePostCollectionData();
  // Initial body + attachments resolve through the detail collection (the
  // context row is a slim list item without `content`).
  const detail = usePostDetail();

  const disabled = isLocked || !canManagePost;

  const updatePostContent = createOptimisticAction<{
    assetIds: string[];
    content: string;
  }>({
    onMutate: ({ assetIds, content }) => {
      // The body lives on the detail collection now (list rows are slim
      // `PostListItem`s without `content`).
      postDetailCollection.update(post.id, (draft) => {
        draft.content = content;
        draft.assetIds = assetIds;
      });
    },
    mutationFn: async ({ assetIds, content }) => {
      await fetchRpc((rpc) =>
        pageType === "Dashboard"
          ? rpc.PostUpdateContent({
              id: post.id,
              boardId: post.boardId,
              organizationId,
              content,
              assetIds,
            })
          : rpc.PostUpdateContentPublic({
              id: post.id,
              boardId: post.boardId,
              organizationId,
              content,
              assetIds,
            })
      );
      await postDetailCollection.utils.refetch();
      await postCollection.utils.refetch();
    },
  });

  if (detail.isLoading || detail.content === undefined) {
    return <ContentSkeleton />;
  }

  return (
    <PostEditor
      content={detail.content}
      disabled={disabled}
      existingAssetIds={detail.assetIds ?? post.assetIds}
      onSubmit={async ({ assetIds, content }) => {
        try {
          const tx = updatePostContent({
            assetIds: content === "" ? [] : assetIds,
            content,
          });
          await tx.isPersisted.promise;
        } catch (error) {
          toastManager.add({
            title: "Failed to update content",
            type: "error",
          });
          throw error;
        }
      }}
      organizationId={organizationId}
      submitLabel="Update"
    >
      <PostEditor.Submit />
    </PostEditor>
  );
}
