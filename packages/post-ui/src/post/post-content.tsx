import { Button } from "@feeblo/ui/button";
import { Editor, type EmailEditorRef } from "@feeblo/ui/editor";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { useDashboardCollections } from "@feeblo/web-shared/dashboard-collections-provider";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import {
  anyPolicy,
  hasOwnerOrAdminRole,
  isUser,
  usePolicy,
} from "@feeblo/web-shared/use-policy";
import { Image01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { debounceStrategy, usePacedMutations } from "@tanstack/react-db";
import { useRef } from "react";
import { z } from "zod";
import { uploadPostEditorImage } from "./post-editor-utils";

const UpdatedPostSchema = z.object({
  id: z.string(),
  statusId: z.string(),
  content: z.string(),
  title: z.string(),
  boardId: z.string(),
  organizationId: z.string(),
});

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
