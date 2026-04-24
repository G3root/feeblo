import "./editor.css";
import {
  BULLET_LIST,
  BubbleMenu,
  BubbleMenuAlignCenter,
  BubbleMenuAlignLeft,
  BubbleMenuAlignRight,
  BubbleMenuBold,
  BubbleMenuCode,
  BubbleMenuItalic,
  BubbleMenuItemGroup,
  BubbleMenuStrike,
  BubbleMenuUnderline,
  BubbleMenuUppercase,
  CODE,
  H1,
  H2,
  H3,
  NUMBERED_LIST,
  QUOTE,
  SlashCommand,
  type SlashCommandItem,
  TableIcon,
  TEXT,
} from "@react-email/editor/ui";
import { Link } from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import { Underline } from "@tiptap/extension-underline";
import {
  type Content,
  EditorProvider,
  type Extensions,
  type JSONContent,
  type Editor as TipTapEditor,
  type UseEditorOptions,
  useCurrentEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { createPasteHandler } from "./core/create-paste-handler";
import { createImageExtension } from "./plugins/image/extension";
import { imageSlashCommand } from "./plugins/image/slash-command";

export interface EmailEditorRef {
  editor: TipTapEditor | null;
  getJSON: () => JSONContent;
}

export interface EditorProps {
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

const TABLE: SlashCommandItem = {
  title: "Table",
  description: "Insert a table",
  icon: <TableIcon size={20} />,
  category: "Layout",
  searchTerms: ["table", "grid"],
  command: ({ editor: currentEditor, range }) => {
    currentEditor
      .chain()
      .focus()
      .deleteRange(range)
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run();
  },
};

const defaultSlashItems = [
  TEXT,
  H1,
  H2,
  H3,
  BULLET_LIST,
  NUMBERED_LIST,
  QUOTE,
  CODE,
  TABLE,
];

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
}: EditorProps) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const imageExtension = useMemo(() => {
    if (!onUploadImage) {
      return null;
    }
    return createImageExtension({ uploadImage: onUploadImage });
  }, [onUploadImage]);

  const extensions = useMemo(() => {
    const base = extensionsProp ?? [
      StarterKit.configure({
        link: false,
        underline: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        enableClickSelection: true,
        HTMLAttributes: {
          rel: null,
          target: null,
        },
      }),

      Table,
      TableRow,
      TableHeader,
      TableCell,
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

    return imageExtension ? [...base, imageExtension] : base;
  }, [extensionsProp, placeholder, imageExtension]);

  const editorProps: UseEditorOptions["editorProps"] = useMemo(
    () => ({
      handlePaste: createPasteHandler({
        extensions,
      }),
    }),
    [extensions]
  );

  const slashItems = useMemo(() => {
    if (onUploadImage) {
      return [...defaultSlashItems, imageSlashCommand];
    }

    return defaultSlashItems;
  }, [onUploadImage]);

  return (
    <EditorProvider
      content={content}
      editable={editable}
      editorContainerProps={{ className }}
      editorProps={{
        ...editorProps,
        attributes: {
          class: "typography",
        },
      }}
      extensions={extensions}
      immediatelyRender={false}
    >
      {editable ? (
        <>
          <BubbleMenu.Root
            hideWhenActiveMarks={bubbleMenu?.hideWhenActiveMarks ?? ["link"]}
          >
            <BubbleMenuItemGroup>
              <BubbleMenuBold />
              <BubbleMenuItalic />
              <BubbleMenuUnderline />
              <BubbleMenuStrike />
              <BubbleMenuCode />
              <BubbleMenuUppercase />
            </BubbleMenuItemGroup>
            <BubbleMenuItemGroup>
              <BubbleMenuAlignLeft />
              <BubbleMenuAlignCenter />
              <BubbleMenuAlignRight />
            </BubbleMenuItemGroup>
          </BubbleMenu.Root>
          <BubbleMenu.LinkDefault />
          <BubbleMenu.ImageDefault />
        </>
      ) : null}
      <SlashCommand items={slashItems} />
      <RefBridge editorRef={ref} onUpdateRef={onUpdateRef} />
      <EmailEditorReadyBridge onReadyRef={onReadyRef} />

      {children}
    </EditorProvider>
  );
}
