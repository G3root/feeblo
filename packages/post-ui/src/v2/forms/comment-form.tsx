import { CommentId } from "@feeblo/id";
import { useAppForm, withForm } from "@feeblo/ui/hooks/form";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { formOptions } from "@tanstack/react-form";
import type { Dispatch, SetStateAction } from "react";
import z from "zod";
import {
  CommentComposer,
  type CommentComposerProviderProps,
} from "../comment-composer";
import { usePostCollectionData } from "../post-page-context";
import { usePostCollections } from "../providers/post-collections-provider";

const CommentVisibilitySchema = z.enum(["PUBLIC", "INTERNAL"]);

type TVisibilitySchema = z.infer<typeof CommentVisibilitySchema>;

const Schema = z.object({
  content: z.string().min(1, "this field is required"),
  visibility: CommentVisibilitySchema,
});

type TSchema = z.infer<typeof Schema>;

const defaultVisibility: TVisibilitySchema = "PUBLIC";

export const commentCreateFormOpts = formOptions({
  defaultValues: {
    content: "",
    visibility: defaultVisibility as TVisibilitySchema,
  },
  validators: {
    onChange: Schema,
  },
});

interface useCommentFormProps {
  defaultValues?: Partial<TSchema>;
  setEditorKey: Dispatch<SetStateAction<number>>;
  showVisibilityPicker: boolean;
}

export const useCommentForm = ({
  defaultValues,
  setEditorKey,
}: useCommentFormProps) => {
  const { post, organizationId } = usePostCollectionData();
  const postId = post.id;
  const {
    collections: { commentCollection },
  } = usePostCollections();

  const { data: session } = useAuthState();

  return useAppForm({
    ...commentCreateFormOpts,
    defaultValues: {
      content: "",
      visibility: defaultVisibility as TVisibilitySchema,
      ...(defaultValues ? defaultValues : {}),
    },
    onSubmit: async ({ value }) => {
      if (!session) {
        return;
      }

      const membership = session.memberships.find(
        (value) =>
          value.organizationId === organizationId &&
          value.userId === session.user.id
      );

      const tx = commentCollection.insert({
        id: await CommentId.unsafeGenerate(),
        createdAt: new Date(),
        updatedAt: new Date(),
        content: value.content,
        visibility: value.visibility,
        parentCommentId: null,
        organizationId,
        memberId: membership?.membershipId ?? null,
        postId,
        userId: session.user.id,
        user: {
          name: session.user.name,
        },
      });

      await tx.isPersisted.promise;

      setEditorKey((val) => val + 1);
    },
  });
};

export const CommentComposerField = withForm({
  ...commentCreateFormOpts,
  props: {} as CommentComposerProviderProps,
  render: ({ form, ...rest }) => {
    return (
      <form.AppField name="content">
        {(field) => (
          <form.AppField name="visibility">
            {(visibility) => (
              <CommentComposer.Provider
                isPrivate={visibility.state.value === "INTERNAL"}
                onContentChange={field.handleChange}
                onVisibilityChange={(isPrivate) =>
                  visibility.handleChange(isPrivate ? "INTERNAL" : "PUBLIC")
                }
                {...rest}
              >
                <div className="rounded-md border border-border p-3">
                  <CommentComposer.Editor />
                  <CommentComposer.Submit />
                </div>
              </CommentComposer.Provider>
            )}
          </form.AppField>
        )}
      </form.AppField>
    );
  },
});
