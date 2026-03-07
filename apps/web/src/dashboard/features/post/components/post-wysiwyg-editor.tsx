import { generateId } from "@feeblo/utils/id";
import { ArrowUp02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type Content,
  type Editor,
  type JSONContent,
  mergeAttributes,
  Node,
} from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { useAppForm } from "~/hooks/form";
import {
  authClient,
  editorMediaUploadEndpoint,
  type UploadedEditorMedia,
  uploadedEditorMediaSchema,
} from "~/lib/auth-client";
import { commentCollection } from "~/lib/collections";
import { cn } from "~/lib/utils";

const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_BYTES = 100 * 1024 * 1024;

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const SUPPORTED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

type MediaKind = "image" | "video";

type MediaUploadAttrs = {
  alt?: string | null;
  src: string;
  uploadId?: string | null;
  uploadState?: "finished" | "uploading";
};

const ImageNode = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: "" },
      alt: { default: null },
      uploadId: { default: null, rendered: false },
      uploadState: {
        default: "finished",
        parseHTML: (element) =>
          element.getAttribute("data-upload-state") ?? "finished",
        renderHTML: (attributes) => ({
          "data-upload-state": attributes.uploadState,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "img[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "img",
      mergeAttributes(
        {
          class:
            "my-4 max-h-[28rem] w-auto max-w-full rounded-lg border border-border/60 object-contain",
        },
        HTMLAttributes
      ),
    ];
  },
});

const VideoNode = Node.create({
  name: "video",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: "" },
      uploadId: { default: null, rendered: false },
      uploadState: {
        default: "finished",
        parseHTML: (element) =>
          element.getAttribute("data-upload-state") ?? "finished",
        renderHTML: (attributes) => ({
          "data-upload-state": attributes.uploadState,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "video[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "video",
      mergeAttributes(
        {
          class:
            "my-4 max-h-[28rem] w-full rounded-lg border border-border/60 bg-black",
          controls: "true",
          playsinline: "true",
          preload: "metadata",
        },
        HTMLAttributes
      ),
    ];
  },
});

const editorExtensions = [
  StarterKit.configure({
    heading: {
      levels: [1, 2, 3],
    },
  }),
  ImageNode,
  VideoNode,
];

type SlashCommand = {
  id: string;
  label: string;
  run: (editor: Editor) => void;
};

type SelectionMenuState = {
  visible: boolean;
  x: number;
  y: number;
};

const slashCommands: SlashCommand[] = [
  {
    id: "text",
    label: "Text",
    run: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    id: "h1",
    label: "Heading 1",
    run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: "h2",
    label: "Heading 2",
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: "bullet",
    label: "Bullet list",
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: "ordered",
    label: "Numbered list",
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "quote",
    label: "Quote",
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "code",
    label: "Code block",
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
];

const EDITOR_BASE_CLASS =
  "text-sm leading-7 text-foreground outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror_h1]:mb-3 [&_.ProseMirror_h1]:mt-6 [&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h1]:font-semibold [&_.ProseMirror_h2]:mb-2 [&_.ProseMirror_h2]:mt-5 [&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-medium [&_.ProseMirror_h3]:mb-2 [&_.ProseMirror_h3]:mt-4 [&_.ProseMirror_h3]:text-lg [&_.ProseMirror_h3]:font-medium [&_.ProseMirror_p]:my-2 [&_.ProseMirror_ul]:my-3 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ol]:my-3 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_li]:my-1 [&_.ProseMirror_blockquote]:my-4 [&_.ProseMirror_blockquote]:border-l [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_blockquote]:text-muted-foreground [&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:bg-muted [&_.ProseMirror_code]:px-1.5 [&_.ProseMirror_code]:py-0.5 [&_.ProseMirror_pre]:my-4 [&_.ProseMirror_pre]:overflow-x-auto [&_.ProseMirror_pre]:rounded-md [&_.ProseMirror_pre]:bg-muted [&_.ProseMirror_pre]:p-4 [&_.ProseMirror_img[data-upload-state='uploading']]:animate-pulse [&_.ProseMirror_video[data-upload-state='uploading']]:animate-pulse";

function parseDocumentJson(content: string): JSONContent | null {
  const trimmed = content.trim();
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as JSONContent;
    if (parsed?.type === "doc") {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function looksLikeHtml(content: string) {
  return /<\/?[a-z][\s\S]*>/i.test(content);
}

function createParagraphNodesFromText(content: string): JSONContent[] {
  const lines = content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [{ type: "paragraph" }];
  }

  return lines.map((line) => ({
    type: "paragraph",
    content: [{ type: "text", text: line }],
  }));
}

function createEditorContent(content: string): Content {
  if (content.trim().length === 0) {
    return {
      type: "doc",
      content: [{ type: "paragraph" }],
    };
  }

  const parsedDoc = parseDocumentJson(content);
  if (parsedDoc) {
    return parsedDoc;
  }

  if (looksLikeHtml(content)) {
    return content;
  }

  return {
    type: "doc",
    content: createParagraphNodesFromText(content),
  };
}

function jsonNodeHasMeaningfulContent(node: JSONContent | null | undefined) {
  if (!node) {
    return false;
  }

  if (node.type === "image" || node.type === "video") {
    return true;
  }

  if (typeof node.text === "string" && node.text.trim().length > 0) {
    return true;
  }

  if (!Array.isArray(node.content)) {
    return false;
  }

  return node.content.some((child) => jsonNodeHasMeaningfulContent(child));
}

function stripHtmlToText(content: string) {
  return content
    .replace(/<img[^>]*>/gi, " media ")
    .replace(/<video[\s\S]*?>[\s\S]*?<\/video>/gi, " media ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isRichTextContentEmpty(content: string) {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return true;
  }

  const parsedDoc = parseDocumentJson(trimmed);
  if (parsedDoc) {
    return !jsonNodeHasMeaningfulContent(parsedDoc);
  }

  if (looksLikeHtml(trimmed)) {
    if (/<(img|video)\b/i.test(trimmed)) {
      return false;
    }

    return stripHtmlToText(trimmed).length === 0;
  }

  return trimmed.length === 0;
}

type EditorOutputFormat = "html" | "text";

function serializeEditorContent(editor: Editor, format: EditorOutputFormat) {
  if (format === "text") {
    return editor.getText().trim();
  }

  const html = editor.getHTML();
  return isRichTextContentEmpty(html) ? "" : html;
}

function getMediaKind(file: File): MediaKind | null {
  if (SUPPORTED_IMAGE_TYPES.has(file.type)) {
    return "image";
  }
  if (SUPPORTED_VIDEO_TYPES.has(file.type)) {
    return "video";
  }
  return null;
}

function getMaxFileSize(kind: MediaKind) {
  return kind === "image" ? MAX_IMAGE_UPLOAD_BYTES : MAX_VIDEO_UPLOAD_BYTES;
}

function findMediaNodePosition(editor: Editor, uploadId: string) {
  let foundPos: number | null = null;

  editor.state.doc.descendants((node, pos) => {
    const isMediaNode =
      node.type.name === "image" || node.type.name === "video";
    if (!isMediaNode) {
      return true;
    }

    if (node.attrs.uploadId === uploadId) {
      foundPos = pos;
      return false;
    }

    return true;
  });

  return foundPos;
}

function updateMediaNode(
  editor: Editor,
  uploadId: string,
  attrs: Partial<MediaUploadAttrs>
) {
  const pos = findMediaNodePosition(editor, uploadId);
  if (pos == null) {
    return;
  }

  const node = editor.state.doc.nodeAt(pos);
  if (!node) {
    return;
  }

  const tr = editor.state.tr.setNodeMarkup(pos, node.type, {
    ...node.attrs,
    ...attrs,
  });
  editor.view.dispatch(tr);
}

function removeMediaNode(editor: Editor, uploadId: string) {
  const pos = findMediaNodePosition(editor, uploadId);
  if (pos == null) {
    return;
  }

  const node = editor.state.doc.nodeAt(pos);
  if (!node) {
    return;
  }

  const tr = editor.state.tr.delete(pos, pos + node.nodeSize);
  editor.view.dispatch(tr);
}

async function uploadEditorMedia(file: File): Promise<UploadedEditorMedia> {
  const formData = new FormData();
  formData.set("file", file);

  const response = await fetch(editorMediaUploadEndpoint, {
    body: formData,
    credentials: "include",
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Upload failed");
  }

  const payload = await response.json();
  return uploadedEditorMediaSchema.parse(payload);
}

function SelectionFormattingMenu({
  editor,
  selectionMenu,
}: {
  editor: Editor;
  selectionMenu: SelectionMenuState;
}) {
  if (!selectionMenu.visible) {
    return null;
  }

  return (
    <div
      className="absolute z-20 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-md border bg-card p-1 shadow-sm"
      style={{ left: selectionMenu.x, top: selectionMenu.y }}
    >
      <Button
        className="h-8 px-2 text-xs"
        onClick={() => editor.chain().focus().toggleBold().run()}
        size="sm"
        type="button"
        variant={editor.isActive("bold") ? "secondary" : "ghost"}
      >
        B
      </Button>
      <Button
        className="h-8 px-2 text-xs italic"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        size="sm"
        type="button"
        variant={editor.isActive("italic") ? "secondary" : "ghost"}
      >
        I
      </Button>
      <Button
        className="h-8 px-2 text-xs"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        size="sm"
        type="button"
        variant={editor.isActive("strike") ? "secondary" : "ghost"}
      >
        S
      </Button>
      <Button
        className="h-8 px-2 text-xs"
        onClick={() => editor.chain().focus().toggleCode().run()}
        size="sm"
        type="button"
        variant={editor.isActive("code") ? "secondary" : "ghost"}
      >
        Code
      </Button>
    </div>
  );
}

function SlashCommandsMenu({
  commands,
  onSelect,
}: {
  commands: SlashCommand[];
  onSelect: (command: SlashCommand) => void;
}) {
  if (commands.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 w-full max-w-xs rounded-md border bg-card p-1 shadow-sm">
      {commands.map((command) => (
        <button
          className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
          key={command.id}
          onClick={() => onSelect(command)}
          type="button"
        >
          {command.label}
        </button>
      ))}
    </div>
  );
}

type EditorFrameProps = {
  allowMediaUpload?: boolean;
  content: string;
  editorClassName?: string;
  footer?: ReactNode;
  onContentChange?: (content: string) => void;
  outputFormat?: EditorOutputFormat;
  placeholderClassName?: string;
  placeholder: string;
  readOnly?: boolean;
  wrapperClassName?: string;
};

function PostRichTextEditor({
  allowMediaUpload = false,
  content,
  editorClassName,
  footer,
  onContentChange,
  outputFormat = "html",
  placeholderClassName,
  placeholder,
  readOnly = false,
  wrapperClassName,
}: EditorFrameProps) {
  const [slashQuery, setSlashQuery] = useState("");
  const [slashRange, setSlashRange] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenuState>({
    visible: false,
    x: 0,
    y: 0,
  });
  const [activeUploads, setActiveUploads] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const lastSyncedContentRef = useRef(content);
  const initialContent = useMemo(() => createEditorContent(content), [content]);

  const filteredSlashCommands = useMemo(() => {
    const normalizedQuery = slashQuery.trim().toLowerCase();

    if (normalizedQuery.length === 0) {
      return slashCommands;
    }

    return slashCommands.filter((command) =>
      command.label.toLowerCase().includes(normalizedQuery)
    );
  }, [slashQuery]);

  const hideSlashMenu = useCallback(() => {
    setSlashRange(null);
    setSlashQuery("");
  }, []);

  const handleFilesUpload = useCallback(
    async (files: File[], position?: number) => {
      if (!(files.length > 0 && editorMediaUploadEndpoint)) {
        return;
      }

      const activeEditor = editorRef.current;
      if (!activeEditor) {
        return;
      }

      let insertPosition = position;

      for (const file of files) {
        const mediaKind = getMediaKind(file);
        if (!mediaKind) {
          toastManager.add({
            title:
              "Unsupported file type. Use PNG/JPEG/WEBP/GIF or MP4/WebM/MOV",
            type: "error",
          });
          continue;
        }

        const maxSize = getMaxFileSize(mediaKind);
        if (file.size === 0 || file.size > maxSize) {
          const maxSizeMb = Math.round(maxSize / (1024 * 1024));
          toastManager.add({
            title: `File must be between 1B and ${maxSizeMb}MB`,
            type: "error",
          });
          continue;
        }

        const uploadId = `upload-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 9)}`;
        const previewUrl = URL.createObjectURL(file);

        const chain = activeEditor.chain().focus();
        if (typeof insertPosition === "number") {
          chain.setTextSelection(insertPosition);
        }

        const attrs: MediaUploadAttrs = {
          src: previewUrl,
          uploadId,
          uploadState: "uploading",
        };
        if (mediaKind === "image") {
          attrs.alt = file.name;
        }

        chain.insertContent({
          type: mediaKind,
          attrs,
        });

        const inserted = chain.run();
        if (!inserted) {
          URL.revokeObjectURL(previewUrl);
          toastManager.add({
            title: "Failed to insert media into editor",
            type: "error",
          });
          continue;
        }

        if (typeof insertPosition === "number") {
          insertPosition += 1;
        }

        setActiveUploads((value) => value + 1);

        try {
          const uploaded = await uploadEditorMedia(file);
          updateMediaNode(activeEditor, uploadId, {
            src: uploaded.url,
            uploadState: "finished",
          });
        } catch (_error) {
          removeMediaNode(activeEditor, uploadId);
          toastManager.add({
            title: `Failed to upload "${file.name}"`,
            type: "error",
          });
        } finally {
          URL.revokeObjectURL(previewUrl);
          setActiveUploads((value) => Math.max(0, value - 1));
        }
      }
    },
    []
  );

  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: editorExtensions,
    content: initialContent,
    editorProps: {
      attributes: {
        class: `${EDITOR_BASE_CLASS} ${editorClassName ?? ""}`,
      },
      handleDrop: (_view, event) => {
        if (readOnly || !allowMediaUpload) {
          return false;
        }

        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0) {
          return false;
        }

        const position = editorRef.current?.view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        })?.pos;

        void handleFilesUpload(files, position);
        return true;
      },
      handlePaste: (_view, event) => {
        if (readOnly || !allowMediaUpload) {
          return false;
        }

        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length === 0) {
          return false;
        }

        void handleFilesUpload(files);
        return true;
      },
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    if (content === lastSyncedContentRef.current) {
      return;
    }

    editor.commands.setContent(createEditorContent(content), false);
    lastSyncedContentRef.current = content;
  }, [content, editor]);

  useEffect(() => {
    if (!editor || readOnly) {
      setSelectionMenu({ visible: false, x: 0, y: 0 });
      hideSlashMenu();
      return;
    }

    const updateEditorOverlays = () => {
      const { selection } = editor.state;

      if (!selection.empty) {
        const browserSelection = window.getSelection();
        const range = browserSelection?.rangeCount
          ? browserSelection.getRangeAt(0)
          : null;
        const rect = range?.getBoundingClientRect();
        const wrapperRect = wrapperRef.current?.getBoundingClientRect();

        if (rect && wrapperRect && rect.width > 0 && rect.height > 0) {
          setSelectionMenu({
            visible: true,
            x: rect.left + rect.width / 2 - wrapperRect.left,
            y: rect.top - wrapperRect.top - 8,
          });
        } else {
          setSelectionMenu({ visible: false, x: 0, y: 0 });
        }

        hideSlashMenu();
        return;
      }

      setSelectionMenu({ visible: false, x: 0, y: 0 });

      const { $from } = selection;
      const beforeCursor = $from.parent.textBetween(0, $from.parentOffset, " ");
      const slashMatch = beforeCursor.match(/(?:^|\s)\/([a-zA-Z]*)$/);

      if (!slashMatch) {
        hideSlashMenu();
        return;
      }

      const query = slashMatch[1] ?? "";
      const from = selection.from - query.length - 1;
      setSlashRange({ from, to: selection.from });
      setSlashQuery(query);
    };

    editor.on("update", updateEditorOverlays);
    editor.on("selectionUpdate", updateEditorOverlays);
    editor.on("blur", hideSlashMenu);
    updateEditorOverlays();

    return () => {
      editor.off("update", updateEditorOverlays);
      editor.off("selectionUpdate", updateEditorOverlays);
      editor.off("blur", hideSlashMenu);
    };
  }, [editor, hideSlashMenu, readOnly]);

  useEffect(() => {
    if (!(editor && onContentChange)) {
      return;
    }

    const handler = () => {
      const serialized = serializeEditorContent(editor, outputFormat);
      lastSyncedContentRef.current = serialized;
      onContentChange(serialized);
    };

    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor, onContentChange, outputFormat]);

  if (!editor) {
    return null;
  }

  const supportsMediaUpload = allowMediaUpload && !readOnly;
  const showSlashMenu =
    !readOnly && Boolean(slashRange) && filteredSlashCommands.length > 0;

  const applySlashCommand = (command: SlashCommand) => {
    if (!slashRange) {
      return;
    }

    editor.chain().focus().deleteRange(slashRange).run();
    command.run(editor);
    hideSlashMenu();
  };

  return (
    <div className={cn("relative", wrapperClassName)} ref={wrapperRef}>
      {readOnly ? null : (
        <SelectionFormattingMenu
          editor={editor}
          selectionMenu={selectionMenu}
        />
      )}

      <EditorContent editor={editor} />

      {!readOnly && editor.isEmpty ? (
        <p
          className={cn(
            "pointer-events-none absolute text-muted-foreground text-sm leading-7",
            "top-0 left-1",
            placeholderClassName
          )}
        >
          {placeholder}
        </p>
      ) : null}

      {showSlashMenu ? (
        <SlashCommandsMenu
          commands={filteredSlashCommands}
          onSelect={applySlashCommand}
        />
      ) : null}

      {supportsMediaUpload || footer || activeUploads > 0 ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {supportsMediaUpload ? (
              <>
                <input
                  accept={[
                    ...SUPPORTED_IMAGE_TYPES,
                    ...SUPPORTED_VIDEO_TYPES,
                  ].join(",")}
                  className="hidden"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    if (files.length > 0) {
                      void handleFilesUpload(files);
                    }
                  }}
                  ref={fileInputRef}
                  type="file"
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Add media
                </Button>
              </>
            ) : null}

            {activeUploads > 0 ? (
              <span className="text-muted-foreground text-xs">
                Uploading {activeUploads} file{activeUploads > 1 ? "s" : ""}…
              </span>
            ) : null}
          </div>

          {footer ? <div>{footer}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function PostDescriptionEditor({
  content,
  onContentChange,
}: {
  content: string;
  onContentChange?: (content: string) => void;
}) {
  const readOnly = !onContentChange;

  return (
    <PostRichTextEditor
      allowMediaUpload={!readOnly}
      content={content}
      editorClassName={cn("min-h-24", readOnly ? "pointer-events-none" : null)}
      onContentChange={onContentChange}
      outputFormat="html"
      placeholder="Add description..."
      placeholderClassName="left-1 top-0"
      readOnly={readOnly}
    />
  );
}

type PostCommentEditorProps = {
  organizationId: string;
  postId: string;
};

export function PostCommentEditor({
  organizationId,
  postId,
}: PostCommentEditorProps) {
  const [editorKey, setEditorKey] = useState(0);

  const { data: session } = authClient.useSession();

  const form = useAppForm({
    defaultValues: { content: "" },
    validators: {
      onSubmit: z.object({
        content: z
          .string()
          .refine(
            (value) => !isRichTextContentEmpty(value),
            "Comment is required"
          ),
      }),
    },
    onSubmit: async ({ value }) => {
      try {
        const userId = session?.user?.id;
        const userName = session?.user?.name;

        if (!(userId && userName)) {
          throw new Error("User not found");
        }

        const tx = commentCollection.insert({
          id: generateId("comment"),
          createdAt: new Date(),
          updatedAt: new Date(),
          content: value.content,
          visibility: "PUBLIC",
          parentCommentId: null,
          organizationId,
          memberId: null,
          postId,
          userId,
          user: {
            name: userName,
          },
        });
        await tx.isPersisted.promise;

        setEditorKey((k) => k + 1);
        form.reset();
        toastManager.add({ title: "Comment added", type: "success" });
      } catch (_error) {
        toastManager.add({ title: "Failed to add comment", type: "error" });
      }
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
    >
      <PostRichTextEditor
        allowMediaUpload={false}
        content=""
        editorClassName="min-h-8 [&_.ProseMirror_p]:my-0"
        footer={
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button
                className="rounded-full"
                disabled={isSubmitting}
                size="icon-xs"
                type="submit"
                variant="outline"
              >
                <HugeiconsIcon icon={ArrowUp02Icon} strokeWidth={2} />
                <span className="sr-only">Submit comment</span>
              </Button>
            )}
          </form.Subscribe>
        }
        key={editorKey}
        onContentChange={(content) => form.setFieldValue("content", content)}
        outputFormat="text"
        placeholder="Leave a comment..."
        placeholderClassName="left-4 top-4"
        wrapperClassName="rounded-xl border p-4"
      />
    </form>
  );
}
