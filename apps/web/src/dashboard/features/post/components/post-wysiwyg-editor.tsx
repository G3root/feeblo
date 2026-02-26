import { generateId } from "@feeblo/utils/id";
import { ArrowUp02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { useAppForm } from "~/hooks/form";
import { authClient } from "~/lib/auth-client";
import { commentCollection } from "~/lib/collections";
import { cn } from "~/lib/utils";

type SlashCommand = {
  id: string;
  label: string;
  run: (editor: Editor) => void;
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

type EditorFrameProps = {
  content: string;
  editorClassName?: string;
  footer?: React.ReactNode;
  onContentChange?: (content: string) => void;
  placeholderClassName?: string;
  placeholder: string;
  wrapperClassName?: string;
};

function PostRichTextEditor({
  content,
  editorClassName,
  footer,
  onContentChange,
  placeholderClassName,
  placeholder,
  wrapperClassName,
}: EditorFrameProps) {
  const [slashQuery, setSlashQuery] = useState("");
  const [slashRange, setSlashRange] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
  }>({ visible: false, x: 0, y: 0 });
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const filteredSlashCommands = useMemo(() => {
    const normalizedQuery = slashQuery.trim().toLowerCase();

    if (normalizedQuery.length === 0) {
      return slashCommands;
    }

    return slashCommands.filter((command) =>
      command.label.toLowerCase().includes(normalizedQuery)
    );
  }, [slashQuery]);

  const hideSlashMenu = () => {
    setSlashRange(null);
    setSlashQuery("");
  };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
    ],
    content:
      content.length > 0
        ? {
            type: "doc",
            content: content
              .split(/\n+/)
              .filter((line) => line.trim().length > 0)
              .map((line) => ({
                type: "paragraph",
                content: [{ type: "text", text: line }],
              })),
          }
        : {
            type: "doc",
            content: [{ type: "paragraph" }],
          },
    editorProps: {
      attributes: {
        class: `text-sm leading-7 text-foreground outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror_h1]:mb-3 [&_.ProseMirror_h1]:mt-6 [&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h1]:font-semibold [&_.ProseMirror_h2]:mb-2 [&_.ProseMirror_h2]:mt-5 [&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-medium [&_.ProseMirror_h3]:mb-2 [&_.ProseMirror_h3]:mt-4 [&_.ProseMirror_h3]:text-lg [&_.ProseMirror_h3]:font-medium [&_.ProseMirror_p]:my-2 [&_.ProseMirror_ul]:my-3 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ol]:my-3 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_li]:my-1 [&_.ProseMirror_blockquote]:my-4 [&_.ProseMirror_blockquote]:border-l [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_blockquote]:text-muted-foreground [&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:bg-muted [&_.ProseMirror_code]:px-1.5 [&_.ProseMirror_code]:py-0.5 [&_.ProseMirror_pre]:my-4 [&_.ProseMirror_pre]:overflow-x-auto [&_.ProseMirror_pre]:rounded-md [&_.ProseMirror_pre]:bg-muted [&_.ProseMirror_pre]:p-4 ${editorClassName ?? ""}`,
      },
    },
  });

  useEffect(() => {
    if (!editor) {
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
  }, [editor]);

  useEffect(() => {
    if (!(editor && onContentChange)) {
      return;
    }
    const handler = () => onContentChange(editor.getText());
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor, onContentChange]);

  if (!editor) {
    return null;
  }

  const showSlashMenu = slashRange && filteredSlashCommands.length > 0;

  return (
    <div className={cn("relative", wrapperClassName)} ref={wrapperRef}>
      {selectionMenu.visible ? (
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
      ) : null}

      <EditorContent editor={editor} />

      {editor.isEmpty ? (
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
        <div className="mt-3 w-full max-w-xs rounded-md border bg-card p-1 shadow-sm">
          {filteredSlashCommands.map((command) => (
            <button
              className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              key={command.id}
              onClick={() => {
                if (!slashRange) {
                  return;
                }

                editor.chain().focus().deleteRange(slashRange).run();
                command.run(editor);
                hideSlashMenu();
              }}
              type="button"
            >
              {command.label}
            </button>
          ))}
        </div>
      ) : null}

      {footer ? (
        <div className="mt-3 flex items-center justify-end">{footer}</div>
      ) : null}
    </div>
  );
}

export function PostDescriptionEditor({ content }: { content: string }) {
  return (
    <PostRichTextEditor
      content={content}
      editorClassName="min-h-28"
      placeholder="Add description..."
      placeholderClassName="left-1 top-0"
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
      onChange: z.object({
        content: z.string().min(1),
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
        content=""
        editorClassName="min-h-7 [&_.ProseMirror_p]:my-0"
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
        placeholder="Leave a comment..."
        placeholderClassName="left-4 top-4"
        wrapperClassName="rounded-xl border  p-4"
      />
    </form>
  );
}
