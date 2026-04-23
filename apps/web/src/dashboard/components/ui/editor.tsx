import Placeholder from "@tiptap/extension-placeholder";
import {
  type Content,
  EditorProvider,
  type Extensions,
  type JSONContent,
  type Editor as TipTapEditor,
  type UseEditorOptions,
  useCurrentEditor,
} from "@tiptap/react";
import {
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { createPasteHandler } from "./editor/core/create-paste-handler";

export interface EmailEditorRef {
  editor: TipTapEditor | null;
  getJSON: () => JSONContent;
}

export interface EmailEditorProps {
  bubbleMenu?: {
    hideWhenActiveNodes?: string[];
    hideWhenActiveMarks?: string[];
  };
  children?: ReactNode;
  className?: string;
  content?: Content;

  editable?: boolean;
  extensions?: Extensions;
  onReady?: (ref: EmailEditorRef) => void;
  onUpdate?: (ref: EmailEditorRef) => void;
  onUploadImage?: (file: File) => Promise<{ url: string }>;
  placeholder?: string;
  ref: Ref<EmailEditorRef>;
}

function buildRef(editor: TipTapEditor | null): EmailEditorRef {
  return {
    getJSON: () => editor?.getJSON() ?? { type: "doc", content: [] },
    editor,
  };
}

function RefBridge({
  editorRef,
  onUpdateRef,
}: {
  editorRef: Ref<EmailEditorRef>;
  onUpdateRef: React.RefObject<((ref: EmailEditorRef) => void) | undefined>;
}) {
  const { editor } = useCurrentEditor();

  const emailEditorRef = useMemo(() => buildRef(editor), [editor]);

  useImperativeHandle(editorRef, () => emailEditorRef, [emailEditorRef]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const handler = () => {
      onUpdateRef.current?.(emailEditorRef);
    };

    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor, emailEditorRef, onUpdateRef]);

  return null;
}

function EmailEditorReadyBridge({
  onReadyRef,
}: {
  onReadyRef: React.RefObject<((ref: EmailEditorRef) => void) | undefined>;
}) {
  const { editor } = useCurrentEditor();

  useLayoutEffect(() => {
    if (!editor) {
      return;
    }
    onReadyRef.current?.(buildRef(editor));
  }, [editor, onReadyRef]);

  return null;
}

export function Editor({
  content,
  onUpdate,
  onReady,

  editable = true,
  placeholder,
  bubbleMenu,
  extensions: extensionsProp,
  onUploadImage,
  className,
  children,
  ref,
}: EmailEditorProps) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const extensions = useMemo(() => {
    const base = extensionsProp ?? [
      //   StarterKit.configure(),
      Placeholder.configure({
        placeholder:
          placeholder ??
          (({ node }) => {
            // TODO: this heading placeholder is not working,
            // in part because styles are only targetting paragraphs,
            // but in part because of the way the content is rendered
            if (node.type.name === "heading") {
              return `Heading ${node.attrs.level}`;
            }
            return "Press '/' for commands";
          }),
        includeChildren: true,
      }),
    ];

    return base;
  }, [extensionsProp, placeholder]);

  const editorProps: UseEditorOptions["editorProps"] = useMemo(
    () => ({
      handlePaste: createPasteHandler({
        extensions,
      }),
    }),
    [extensions]
  );

  return (
    <EditorProvider
      content={content}
      editable={editable}
      editorContainerProps={{ className }}
      editorProps={editorProps}
      extensions={extensions}
      immediatelyRender={false}
    >
      <RefBridge editorRef={ref} onUpdateRef={onUpdateRef} />
      <EmailEditorReadyBridge onReadyRef={onReadyRef} />

      {children}
    </EditorProvider>
  );
}
