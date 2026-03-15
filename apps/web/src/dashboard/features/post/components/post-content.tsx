import { Image01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { debounceStrategy, usePacedMutations } from "@tanstack/react-db";
import { useRef } from "react";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { Editor, type EditorHandle } from "~/components/ui/rich-text-editor";
import {
  allPolicy,
  anyPolicy,
  hasMembership,
  hasOwnerOrAdminRole,
  isUser,
  usePolicy,
} from "~/hooks/use-policy";
import { postCollection } from "~/lib/collections";
import { cn } from "~/lib/utils";
import { fetchRpc } from "~/lib/runtime";
import {
  toRenderableRichTextHtml,
  uploadPostEditorImage,
} from "./post-editor-utils";

const UpdatedPostSchema = z.object({
  id: z.string(),
  status: z.enum([
    "PAUSED",
    "REVIEW",
    "PLANNED",
    "IN_PROGRESS",
    "COMPLETED",
    "CLOSED",
  ]),
  content: z.string(),
  title: z.string(),
  boardId: z.string(),
  organizationId: z.string(),
});

const READONLY_RICH_TEXT_CLASS =
  "public-board-rich-text prose prose-sm max-w-none text-foreground/85 prose-headings:mb-4 prose-headings:font-semibold prose-headings:text-foreground prose-p:my-0 prose-p:mb-5 prose-p:leading-7 prose-strong:text-foreground prose-a:font-medium prose-a:text-foreground prose-a:underline prose-a:decoration-border prose-a:underline-offset-4 prose-blockquote:text-muted-foreground prose-code:text-foreground prose-pre:bg-muted prose-img:my-4 prose-img:max-h-80 prose-img:rounded-lg prose-img:border prose-img:border-border/60 prose-ul:mb-6 prose-ul:space-y-2 prose-ul:pl-5 prose-ol:mb-6 prose-ol:space-y-2 prose-ol:pl-5";

export function PostContentEditor({
  disabled = false,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  const editorRef = useRef<EditorHandle | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const initialValue = useRef(value);

  return (
    <div className="space-y-3">
      <input
        accept="image/gif,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (!files.length) {
            return;
          }
          editorRef.current?.focus();
          editorRef.current?.insertImageFiles(files);
        }}
        ref={imageInputRef}
        type="file"
      />
      <Editor
        disabled={disabled}
        editorClassName="min-h-24"
        enableImagePasteDrop={!disabled}
        onChange={onChange}
        onUploadImage={uploadPostEditorImage}
        placeholder="Add description..."
        ref={editorRef}
        value={initialValue.current}
      />
      {!disabled ? (
        <div className="flex justify-end">
          <Button
            className="rounded-full"
            onClick={() => imageInputRef.current?.click()}
            size="sm"
            type="button"
            variant="outline"
          >
            <HugeiconsIcon icon={Image01Icon} strokeWidth={2} />
            <span>Add image</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function PostEditableContent({
  description,
  organizationId,
  postCreatorId,
  postId,
}: {
  description: string;
  organizationId: string;
  postCreatorId: string | null;
  postId: string;
}) {
  const { allowed: isOwner } = usePolicy(
    anyPolicy(
      hasOwnerOrAdminRole(),
      allPolicy(hasMembership(organizationId), isUser(postCreatorId ?? ""))
    )
  );
  const initialDescription = useRef(description);

  const mutate = usePacedMutations<{ value: string }>({
    onMutate: ({ value }) => {
      postCollection.update(postId, (draft) => {
        draft.content = value;
      });
    },
    mutationFn: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: updatedPost } = mutation;
      const validatedPost = UpdatedPostSchema.parse(updatedPost);
      await fetchRpc((rpc) => rpc.PostUpdate(validatedPost));
    },
    strategy: debounceStrategy({ wait: 500 }),
  });

  return (
    <PostContentEditor
      disabled={!isOwner}
      onChange={(value) => mutate({ value })}
      value={initialDescription.current}
    />
  );
}

export function PostReadonlyContent({
  className,
  content,
}: {
  className?: string;
  content: string;
}) {
  return (
    <div
      className={cn(READONLY_RICH_TEXT_CLASS, className)}
      dangerouslySetInnerHTML={{ __html: toRenderableRichTextHtml(content) }}
    />
  );
}
