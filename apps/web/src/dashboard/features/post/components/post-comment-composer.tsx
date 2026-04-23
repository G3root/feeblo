import { generateId } from "@feeblo/utils/id";
import { ArrowUp02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { Editor, type EmailEditorRef } from "~/components/ui/editor";
import { toastManager } from "~/components/ui/toast";
import { useAppForm } from "~/hooks/form";
import { authClient } from "~/lib/auth-client";
import { commentCollection as dashboardCommentCollection } from "~/lib/collections";
import { isRichTextContentEmpty } from "./post-editor-utils";

type PostCommentComposerProps = {
  commentCollection?: typeof dashboardCommentCollection;
  organizationId: string;
  postId: string;
  unauthenticatedFallback?: ReactNode;
};

export function PostCommentComposer({
  commentCollection = dashboardCommentCollection,
  organizationId,
  postId,
  unauthenticatedFallback = null,
}: PostCommentComposerProps) {
  const editorRef = useRef<EmailEditorRef | null>(null);
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
      <div className="flex rounded-md border p-2">
        <div className="flex w-full flex-col gap-2">
          <Editor
            className="min-w-0 flex-1"
            content=""
            editable
            key={editorKey}
            onUpdate={(ref) =>
              form.setFieldValue("content", ref.editor?.getHTML() ?? "")
            }
            placeholder="Leave a comment..."
            ref={editorRef}
          />
          <div className="flex items-center justify-end">
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
        </div>
      </div>
    </form>
  );
}
