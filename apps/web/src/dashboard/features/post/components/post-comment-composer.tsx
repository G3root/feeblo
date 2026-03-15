import { generateId } from "@feeblo/utils/id";
import { ArrowUp02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState, type ReactNode, useRef } from "react";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { Editor, type EditorHandle } from "~/components/ui/rich-text-editor";
import { toastManager } from "~/components/ui/toast";
import { useAppForm } from "~/hooks/form";
import { authClient } from "~/lib/auth-client";
import { commentCollection } from "~/lib/collections";
import {
  isRichTextContentEmpty,
  uploadPostEditorImage,
} from "./post-editor-utils";

type PostCommentComposerProps = {
  organizationId: string;
  postId: string;
  unauthenticatedFallback?: ReactNode;
};

export function PostCommentComposer({
  organizationId,
  postId,
  unauthenticatedFallback = null,
}: PostCommentComposerProps) {
  const editorRef = useRef<EditorHandle | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const { data: session } = authClient.useSession();

  const userId = session?.user?.id;
  const userName = session?.user?.name;

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
      if (!(userId && userName)) {
        toastManager.add({ title: "Sign in to comment", type: "error" });
        return;
      }

      try {
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
        setEditorKey((current) => current + 1);
        form.reset();
        toastManager.add({ title: "Comment added", type: "success" });
      } catch (_error) {
        toastManager.add({ title: "Failed to add comment", type: "error" });
      }
    },
  });

  if (!(userId && userName)) {
    return unauthenticatedFallback;
  }

  return (
    <form
      className="mt-3"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      <div className="flex items-end gap-8 rounded-md border px-2 py-2">
        <Editor
          className="min-w-0 flex-1 border-0"
          editorClassName="mb-7 min-h-10 px-1 py-1 [&_p]:my-0"
          enableImagePasteDrop
          key={editorKey}
          onChange={(content) => form.setFieldValue("content", content)}
          onUploadImage={uploadPostEditorImage}
          placeholder="Leave a comment..."
          ref={editorRef}
          value=""
        />
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
      </div>
    </form>
  );
}
