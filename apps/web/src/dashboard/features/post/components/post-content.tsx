import { Button } from "@feeblo/ui/button";
import { Editor, type EmailEditorRef } from "@feeblo/ui/editor";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { Image01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { debounceStrategy, usePacedMutations } from "@tanstack/react-db";
import { useRef } from "react";
import { z } from "zod";
import {
  anyPolicy,
  hasOwnerOrAdminRole,
  isUser,
  usePolicy,
} from "~/hooks/use-policy";
import { fetchRpc } from "~/lib/runtime";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import { uploadPostEditorImage } from "./post-editor-utils";

const UpdatedPostSchema = z.object({
  id: z.string(),
  statusId: z.string(),
  content: z.string(),
  title: z.string(),
  boardId: z.string(),
  organizationId: z.string(),
});

const _READONLY_RICH_TEXT_CLASS =
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
  const editorRef = useRef<EmailEditorRef | null>(null);
  const initialValue = useRef(value);

  return (
    <div className="space-y-3">
      <Editor
        className="min-h-24"
        content={initialValue.current}
        editable={!disabled}
        onUpdate={(ref) => onChange(ref.editor?.getHTML() ?? "")}
        onUploadImage={uploadPostEditorImage}
        placeholder="Add description..."
        ref={editorRef}
      />
      {disabled ? null : (
        <div className="flex justify-end">
          <Button
            className="rounded-full"
            onClick={() => {
              editorRef.current?.editor?.commands.focus();
              (
                editorRef.current?.editor?.commands as {
                  uploadImage?: () => boolean;
                }
              )?.uploadImage?.();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <HugeiconsIcon icon={Image01Icon} strokeWidth={2} />
            <span>Add image</span>
          </Button>
        </div>
      )}
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
  const { postCollection } = useDashboardCollections();
  const { allowed: isOwner } = usePolicy(
    anyPolicy(hasOwnerOrAdminRole(organizationId), isUser(postCreatorId ?? ""))
  );
  const initialDescription = useRef(description);

  const mutate = usePacedMutations<{ value: string }>({
    onMutate: ({ value }) => {
      postCollection.update(postId, (draft) => {
        draft.content = value;
        draft.excerpt = htmlToExcerpt(value);
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
