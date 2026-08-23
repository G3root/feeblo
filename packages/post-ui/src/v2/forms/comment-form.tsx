import { COMMENT_CONTENT_MAX_LENGTH } from "@feeblo/domain/content-limits";
import { CommentId } from "@feeblo/id";
import { useAppForm, withForm } from "@feeblo/ui/hooks/form";
import { toastManager } from "@feeblo/ui/toast";
import { parseRpcError } from "@feeblo/web-shared/rpc-error";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { formOptions } from "@tanstack/react-form";
import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import z from "zod";

import {
  CommentComposer,
  type CommentComposerProviderProps,
} from "../comment-composer";
import {
  ContactCombobox,
  describeContactSelection,
  emptyOnBehalfAuthor,
  hasOnBehalfAuthorValue,
  OnBehalfAuthorSchema,
  toOnBehalfAuthor,
} from "../contact-combobox/contact-combobox";
import { usePostCollectionData } from "../post-page-context";
import { usePostCollections } from "../providers/post-collections-provider";

const CommentVisibilitySchema = z.enum(["PUBLIC", "INTERNAL"]);

type TVisibilitySchema = z.infer<typeof CommentVisibilitySchema>;

const CommentContentField = z
  .string()
  .min(1, "this field is required")
  .max(
    COMMENT_CONTENT_MAX_LENGTH,
    `Comments must be at most ${COMMENT_CONTENT_MAX_LENGTH} characters`
  );

const Schema = z.object({
  // The author key uses `.default` so the validator's OUTPUT shape carries a
  // required `author` matching the form values under
  // exactOptionalPropertyTypes (zod `.optional()` would produce an optional
  // modifier instead).
  author: OnBehalfAuthorSchema.default(emptyOnBehalfAuthor),
  content: CommentContentField,
  visibility: CommentVisibilitySchema,
});

type TSchema = z.infer<typeof Schema>;

const defaultVisibility: TVisibilitySchema = "PUBLIC";

export const commentCreateFormOpts = formOptions({
  defaultValues: {
    author: emptyOnBehalfAuthor,
    content: "",
    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
    visibility: defaultVisibility as TVisibilitySchema,
  },
  validators: {
    // A function validator (not a zod schema) because TanStack requires the
    // validator's input AND output types to equal the form values exactly;
    // the author key is server-validated.
    onChange: ({ value }) => {
      const contentParsed = CommentContentField.safeParse(value.content);
      if (!contentParsed.success) {
        // Field-scoped errors must ride under `fields`
        // (GlobalFormValidationError); a flat record would surface as a
        // single global form error.
        return {
          fields: {
            content:
              contentParsed.error.issues[0]?.message ?? "Invalid comment",
          },
        };
      }
      return undefined;
    },
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
      author: emptyOnBehalfAuthor,
      content: "",
      // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
      visibility: defaultVisibility as TVisibilitySchema,
      ...(defaultValues ? defaultValues : undefined),
    },
    onSubmit: async ({ formApi, value }) => {
      if (!session) {
        onAuthRequired?.();
        return;
      }

      const membership = session.memberships.find(
        (value) =>
          value.organizationId === organizationId &&
          value.userId === session.user.id
      );

      // Optimistic attribution must mirror the server's resolved identity:
      // an on-behalf comment is authored by the picked customer, never by
      // the acting member.
      const onBehalf = hasOnBehalfAuthorValue(value.author);
      const optimisticUserId = onBehalf
        ? (value.author?.userId ?? null)
        : session.user.id;
      const optimisticAuthorName = onBehalf
        ? (value.author?.name ?? value.author?.email ?? session.user.name)
        : session.user.name;

      const tx = commentCollection.insert({
        id: await CommentId.unsafeGenerate(),
        createdAt: new Date(),
        updatedAt: new Date(),
        content: value.content,
        visibility: value.visibility,
        parentCommentId: null,
        organizationId,
        memberId: onBehalf ? null : (membership?.membershipId ?? null),
        postId,
        postSlug,
        userId: optimisticUserId ?? session.user.id,
        user: {
          name: optimisticAuthorName,
        },
        ...(hasOnBehalfAuthorValue(value.author)
          ? { author: toOnBehalfAuthor(value.author) }
          : undefined),
      });

      try {
        await tx.isPersisted.promise;
      } catch (error) {
        toastManager.add({
          title: parseRpcError(error).message,
          type: "error",
        });
        return;
      }

      // Drop the picked subject so the next comment is authored by the
      // session user again; the editor resets through `resetKey`.
      formApi.resetField("author");
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
    const { organizationId } = usePostCollections();
    // Mirrors the backend's CommentPolicy gate for CommentCreate.author.
    const commentOnBehalfPolicy = usePolicy(
      hasPermission(organizationId, "comments.createOnBehalf")
    );
    const [isAuthorMode, setIsAuthorMode] = useState(false);

    return (
      <form.AppField name="content">
        {(field) => (
          <form.AppField name="visibility">
            {(visibility) => (
              <form.AppField name="author">
                {(author) => (
                  <CommentComposer.Provider
                    authorDisplay={describeContactSelection(
                      author.state.value ?? null
                    )}
                    authorPicker={
                      <ContactCombobox
                        label="Comment as customer"
                        onSelect={(next) =>
                          author.handleChange(next ?? emptyOnBehalfAuthor)
                        }
                        organizationId={organizationId}
                        placeholder="Search customers by name or email..."
                        value={
                          hasOnBehalfAuthorValue(author.state.value)
                            ? author.state.value
                            : null
                        }
                      />
                    }
                    isAuthorMode={isAuthorMode && commentOnBehalfPolicy.allowed}
                    isPrivate={visibility.state.value === "INTERNAL"}
                    onAuthorToggle={(pressed) => {
                      setIsAuthorMode(pressed);
                      if (!pressed) {
                        author.handleChange(emptyOnBehalfAuthor);
                      }
                    }}
                    onContentChange={field.handleChange}
                    onVisibilityChange={(isPrivate) =>
                      visibility.handleChange(isPrivate ? "INTERNAL" : "PUBLIC")
                    }
                    showAuthorToggle={commentOnBehalfPolicy.allowed}
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
        )}
      </form.AppField>
    );
  },
});
