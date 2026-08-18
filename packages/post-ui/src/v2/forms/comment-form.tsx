import { COMMENT_CONTENT_MAX_LENGTH } from "@feeblo/domain/content-limits";
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
  content: z
    .string()
    .min(1, "this field is required")
    .max(
      COMMENT_CONTENT_MAX_LENGTH,
      `Comments must be at most ${COMMENT_CONTENT_MAX_LENGTH} characters`
    ),
  visibility: CommentVisibilitySchema,
});

type TSchema = z.infer<typeof Schema>;

const defaultVisibility: TVisibilitySchema = "PUBLIC";

export const commentCreateFormOpts = formOptions({
  defaultValues: {
    content: "",
    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
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
  const postSlug = post.slug;
  const {
    collections: { commentCollection },
    onAuthRequired,
  } = usePostCollections();

  const { data: session } = useAuthState();

  return useAppForm({
    ...commentCreateFormOpts,
    defaultValues: {
      content: "",
      // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
      visibility: defaultVisibility as TVisibilitySchema,
      ...(defaultValues ? defaultValues : undefined),
    },
    onSubmit: async ({ value }) => {
      if (!session) {
        onAuthRequired?.();
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
        postSlug,
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
  // SAFETY: Empty-state placeholder for the generic container until real data is set.
  ...commentCreateFormOpts,
  // SAFETY: Empty-state placeholder for the generic container until real data is set.
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
                <div className="border-border rounded-md border p-3">
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
