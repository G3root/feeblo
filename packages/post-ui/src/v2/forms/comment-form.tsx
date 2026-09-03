import { COMMENT_CONTENT_MAX_LENGTH } from "@feeblo/domain/content-limits";
import { CommentId } from "@feeblo/id";
import { useAppForm, withForm } from "@feeblo/ui/hooks/form";
import { toastManager } from "@feeblo/ui/toast";
import { formatPostStatus } from "@feeblo/web-shared/board/constants";
import { parseRpcError } from "@feeblo/web-shared/rpc-error";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { formOptions } from "@tanstack/react-form";
import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import z from "zod";

import {
  CommentComposer,
  commentComposerBoxClassName,
  type CommentComposerProviderProps,
  type TPostStatusOption,
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
  statusUpdateId: z.string().nullable(),
});

type TSchema = z.infer<typeof Schema>;

const defaultVisibility: TVisibilitySchema = "PUBLIC";

export const commentCreateFormOpts = formOptions({
  defaultValues: {
    author: emptyOnBehalfAuthor,
    content: "",
    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
    visibility: defaultVisibility as TVisibilitySchema,
    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
    statusUpdateId: null as string | null,
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

/** Renders the org's post statuses as picker options for the composer. */
export function useCommentComposerStatusOptions(): readonly TPostStatusOption[] {
  const { organizationId } = usePostCollectionData();
  const {
    collections: { postStatusCollection },
  } = usePostCollections();

  const { data: postStatuses } = useLiveQuery(
    (q) =>
      q
        .from({ postStatus: postStatusCollection })
        .where(({ postStatus }) =>
          eq(postStatus.organizationId, organizationId)
        ),
    [organizationId]
  );

  return useMemo(
    () =>
      (postStatuses ?? []).map((postStatus) => ({
        id: postStatus.id,
        type: postStatus.type,
        label: postStatus.label || formatPostStatus(postStatus.type),
        color: postStatus.color ?? null,
      })),
    [postStatuses]
  );
}

type TCreateCommentInput = {
  content: string;
  visibility: TVisibilitySchema;
  /** Set for replies; omitted/null for top-level comments. */
  parentCommentId?: string | null;
  statusUpdateId?: string | null;
  /** Present ⇒ the comment is created on behalf of the resolved customer. */
  author?: import("../contact-combobox/contact-combobox").OnBehalfAuthor;
};

/**
 * Shared optimistic-insert action for top-level comments and replies.
 * Resolves to `false` when there is no session (the host's
 * `onAuthRequired` fires instead) so callers can skip their success side
 * effects — clearing the composer, closing the reply form.
 */
export function useCreateCommentAction() {
  const { post, organizationId } = usePostCollectionData();
  const postId = post.id;
  const postSlug = post.slug;
  const {
    collections: { commentCollection },
    onAuthRequired,
  } = usePostCollections();
  const { data: session } = useAuthState();

  return useCallback(
    async ({
      content,
      visibility,
      parentCommentId = null,
      statusUpdateId = null,
      author,
    }: TCreateCommentInput) => {
      if (!session) {
        onAuthRequired?.();
        return false;
      }

      const membership = session.memberships.find(
        (membership) =>
          membership.organizationId === organizationId &&
          membership.userId === session.user.id
      );

      // Optimistic attribution must mirror the server's resolved identity:
      // an on-behalf comment is authored by the picked customer, never by
      // the acting member.
      const onBehalf = author !== undefined && hasOnBehalfAuthorValue(author);
      const optimisticUserId = onBehalf
        ? (author?.userId ?? null)
        : session.user.id;
      const optimisticAuthorName = onBehalf
        ? (author?.name ?? author?.email ?? session.user.name)
        : session.user.name;

      const tx = commentCollection.insert({
        id: await CommentId.unsafeGenerate(),
        createdAt: new Date(),
        updatedAt: new Date(),
        content,
        visibility,
        statusUpdateId,
        parentCommentId,
        // Optimistic row nests under its raw parent (always visible at
        // creation time); the server re-resolves it for restricted lists.
        resolvedParentCommentId: null,
        organizationId,
        // On-behalf comments keep staff attribution out of the author fields.
        memberId: onBehalf ? null : (membership?.membershipId ?? null),
        postId,
        postSlug,
        userId: optimisticUserId ?? session.user.id,
        pinnedAt: null,
        user: {
          name: optimisticAuthorName,
        },
        ...(author !== undefined && hasOnBehalfAuthorValue(author)
          ? { author: toOnBehalfAuthor(author) }
          : undefined),
      });

      try {
        await tx.isPersisted.promise;
      } catch (error) {
        toastManager.add({
          title: parseRpcError(error).message,
          type: "error",
        });
        return false;
      }

      return true;
    },
    [
      commentCollection,
      onAuthRequired,
      organizationId,
      postId,
      postSlug,
      session,
    ]
  );
}

interface useCommentFormProps {
  defaultValues?: Partial<TSchema>;
  setEditorKey: Dispatch<SetStateAction<number>>;
  showVisibilityPicker: boolean;
}

export const useCommentForm = ({
  defaultValues,
  setEditorKey,
}: useCommentFormProps) => {
  const createComment = useCreateCommentAction();

  return useAppForm({
    ...commentCreateFormOpts,
    defaultValues: {
      author: emptyOnBehalfAuthor,
      content: "",
      // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
      visibility: defaultVisibility as TVisibilitySchema,
      statusUpdateId: null,
      ...(defaultValues ? defaultValues : undefined),
    },
    onSubmit: async ({ formApi, value }) => {
      const created = await createComment({
        content: value.content,
        visibility: value.visibility,
        statusUpdateId: value.statusUpdateId,
        author: value.author,
      });

      if (!created) {
        return;
      }

      // Reset the whole form (not just the editor) so the next comment starts
      // from a clean slate: a stale `content` value here would otherwise be
      // re-submitted with the following comment once the editor re-mounts
      // without emitting a change. Resetting also clears the chosen status
      // update (one-shot, must never be re-applied) and drops the picked
      // on-behalf subject so the next comment is authored by the session
      // user again.
      formApi.reset();
      setEditorKey((val) => val + 1);
    },
  });
};

export const CommentComposerField = withForm({
  // SAFETY: Empty-state placeholder for the generic container until real data is set.
  ...commentCreateFormOpts,
  // SAFETY: Empty-state placeholder for the generic container until real data is set.
  props: {} as CommentComposerProviderProps & { showStatusUpdate?: boolean },
  render: ({ form, disabled, ...rest }) => {
    const { organizationId } = usePostCollections();
    // Mirrors the backend's CommentPolicy gate for CommentCreate.author.
    const commentOnBehalfPolicy = usePolicy(
      hasPermission(organizationId, "comments.createOnBehalf")
    );
    const [isAuthorMode, setIsAuthorMode] = useState(false);

    // Keep the composer inert while the comment persists server-side: the
    // editor is only cleared after the CommentCreate RPC settles, so text
    // typed in that window would otherwise be wiped by the reset — and could
    // race the optimistic insert itself.
    return (
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <form.AppField name="content">
            {(field) => (
              <form.AppField name="visibility">
                {(visibility) => (
                  <form.AppField name="author">
                    {(author) => (
                      <form.AppField name="statusUpdateId">
                        {(statusUpdate) => (
                          <CommentComposerStatusOptions
                            enabled={rest.showStatusUpdate ?? false}
                          >
                            {(statusOptions) => (
                              <CommentComposer.Provider
                                authorDisplay={describeContactSelection(
                                  author.state.value ?? null
                                )}
                                authorPicker={
                                  <ContactCombobox
                                    label="Comment as customer"
                                    onSelect={(next) =>
                                      author.handleChange(
                                        next ?? emptyOnBehalfAuthor
                                      )
                                    }
                                    organizationId={organizationId}
                                    placeholder="Search customers by name or email..."
                                    value={
                                      hasOnBehalfAuthorValue(
                                        author.state.value
                                      )
                                        ? author.state.value
                                        : null
                                    }
                                  />
                                }
                                disabled={disabled || isSubmitting}
                                isAuthorMode={
                                  isAuthorMode &&
                                  commentOnBehalfPolicy.allowed
                                }
                                isPrivate={
                                  visibility.state.value === "INTERNAL"
                                }
                                onAuthorToggle={(pressed) => {
                                  setIsAuthorMode(pressed);
                                  if (!pressed) {
                                    author.handleChange(emptyOnBehalfAuthor);
                                  }
                                }}
                                onContentChange={field.handleChange}
                                onStatusUpdateIdChange={
                                  statusUpdate.handleChange
                                }
                                onVisibilityChange={(isPrivate) =>
                                  visibility.handleChange(
                                    isPrivate ? "INTERNAL" : "PUBLIC"
                                  )
                                }
                                showAuthorToggle={
                                  commentOnBehalfPolicy.allowed
                                }
                                statusOptions={statusOptions}
                                statusUpdateId={statusUpdate.state.value}
                                {...rest}
                              >
                                <div className={commentComposerBoxClassName}>
                                  <CommentComposer.Editor />
                                  <CommentComposer.Submit />
                                </div>
                              </CommentComposer.Provider>
                            )}
                          </CommentComposerStatusOptions>
                        )}
                      </form.AppField>
                    )}
                  </form.AppField>
                )}
              </form.AppField>
            )}
          </form.AppField>
        )}
      </form.Subscribe>
    );
  },
});

/**
 * Bridges the org's post-status collection into the composer's status update
 * picker. `enabled` gates it to members (status updates are a member action);
 * the picker is hidden entirely when no options are provided.
 */
function CommentComposerStatusOptions({
  children,
  enabled,
}: {
  children: (statusOptions: readonly TPostStatusOption[]) => ReactNode;
  enabled: boolean;
}) {
  const statusOptions = useCommentComposerStatusOptions();
  return <>{children(enabled ? statusOptions : [])}</>;
}
