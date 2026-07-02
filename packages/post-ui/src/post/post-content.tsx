import { Editor, type EditorProps, EditorProvider } from "@feeblo/ui/editor";
import { useDashboardCollections } from "@feeblo/web-shared/dashboard-collections-provider";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import {
  anyPolicy,
  hasOwnerOrAdminRole,
  isUser,
  usePolicy,
} from "@feeblo/web-shared/use-policy";
import { debounceStrategy, usePacedMutations } from "@tanstack/react-db";
import { z } from "zod";

const UpdatedPostSchema = z.object({
  id: z.string(),
  statusId: z.string(),
  content: z.string(),
  title: z.string(),
  boardId: z.string(),
  organizationId: z.string(),
});

interface PostContentEditorProps extends EditorProps {
  onChange: (value: string) => void;
  value: string;
}

export function PostContentEditor({
  onChange,
  value,
  readOnly,
  ...rest
}: PostContentEditorProps) {
  return (
    <div className="space-y-3">
      <EditorProvider defaultValue={{ postContent: value }}>
        <Editor
          onChange={(doc) => {
            onChange(doc);
          }}
          placeholder="Add description..."
          readOnly={readOnly}
          {...rest}
        />
      </EditorProvider>

      {
        //TODO: Add image upload button when editor is not readOnly
        readOnly ? null : null
        // <div className="flex justify-end">
        //   <Button
        //     className="rounded-full"
        //     onClick={() => {
        //       editorRef.current?.editor?.commands.focus();
        //       (
        //         editorRef.current?.editor?.commands as {
        //           uploadImage?: () => boolean;
        //         }
        //       )?.uploadImage?.();
        //     }}
        //     size="sm"
        //     type="button"
        //     variant="outline"
        //   >
        //     <HugeiconsIcon icon={Image01Icon} strokeWidth={2} />
        //     <span>Add image</span>
        //   </Button>
        // </div>
      }
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

  const mutate = usePacedMutations<{ value: string }>({
    onMutate: ({ value }) => {
      postCollection.update(postId, (draft) => {
        draft.content = value;
        draft.excerpt = value;
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
    <EditorProvider defaultValue={{ postContent: description }}>
      <Editor
        onChange={(doc) => {
          mutate({ value: doc });
        }}
        readOnly={!isOwner}
      />
    </EditorProvider>
  );
}
