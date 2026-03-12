import { generateId } from "@feeblo/utils/id";
import {
  ArrowUp01Icon,
  ArrowUp02Icon,
  Delete02Icon,
  Image01Icon,
  MoreHorizontalIcon,
  PencilEdit01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  and,
  debounceStrategy,
  eq,
  useLiveSuspenseQuery,
  usePacedMutations,
} from "@tanstack/react-db";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemTitle,
} from "~/components/ui/item";
import { Editor, type EditorHandle } from "~/components/ui/rich-text-editor";
import { Separator } from "~/components/ui/separator";
import { Skeleton } from "~/components/ui/skeleton";
import { toastManager } from "~/components/ui/toast";
import { useAppForm } from "~/hooks/form";
import {
  allPolicy,
  hasMembership,
  isUser,
  usePolicy,
} from "~/hooks/use-policy";
import { authClient } from "~/lib/auth-client";
import {
  commentCollection,
  commentReactionCollection,
  postCollection,
  postReactionCollection,
  upvoteCollection,
} from "~/lib/collections";
import { fetchRpc } from "~/lib/runtime";
import { useCommentDeleteDialogContext } from "../dialog-stores";
import { CommentReactionSection } from "./comment-reaction-section";
import {
  isRichTextContentEmpty,
  toRenderableRichTextHtml,
  uploadPostEditorImage,
} from "./post-editor-utils";
import { PostReactionSection } from "./post-reaction-section";
import { PostTitleInput } from "./post-title-input";

const READONLY_RICH_TEXT_CLASS =
  "prose prose-sm max-w-none text-foreground prose-headings:mb-2 prose-headings:mt-4 prose-headings:text-foreground prose-p:my-2 prose-p:text-foreground prose-strong:text-foreground prose-a:text-foreground prose-blockquote:text-muted-foreground prose-code:text-foreground prose-pre:bg-muted prose-img:my-3 prose-img:max-h-80 prose-img:rounded-lg prose-img:border prose-img:border-border/60";

type PostUpvote = {
  id: string;
  organizationId: string;
  postId: string;
  userId: string;
};

type PostDetailsFormProps = {
  boardName: string;
  boardSlug: string;
  createdAt: Date;
  description: string;
  initialTitle: string;
  organizationId: string;
  postId: string;
  postCreatorId: string | null;
};

export function PostDetailsForm({
  boardName,
  boardSlug,
  createdAt,
  description,
  initialTitle,
  organizationId,
  postId,
  postCreatorId,
}: PostDetailsFormProps) {
  return (
    <PostDetailsLayout>
      <PostDetailsHeader
        boardName={boardName}
        boardSlug={boardSlug}
        organizationId={organizationId}
        postCreatorId={postCreatorId}
        postId={postId}
        title={initialTitle}
      />

      <PostDescriptionEditor
        description={description}
        organizationId={organizationId}
        postCreatorId={postCreatorId}
        postId={postId}
      />

      <PostDetailsActions organizationId={organizationId} postId={postId} />

      <PostCommentComposer organizationId={organizationId} postId={postId} />

      <PostCommentList organizationId={organizationId} postId={postId} />

      <p className="text-muted-foreground text-xs">
        Created {createdAt.toLocaleDateString()}
      </p>
    </PostDetailsLayout>
  );
}

function PostDetailsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <section className="space-y-6">{children}</section>
    </div>
  );
}

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

function PostDescriptionEditor({
  postId,
  description,
  postCreatorId,
  organizationId,
}: {
  postId: string;
  description: string;
  postCreatorId: string | null;
  organizationId: string;
}) {
  const { allowed: isOwner } = usePolicy(
    allPolicy(hasMembership(organizationId), isUser(postCreatorId ?? ""))
  );
  const postEditorRef = useRef<EditorHandle | null>(null);
  const postImageInputRef = useRef<HTMLInputElement | null>(null);
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
          postEditorRef.current?.focus();
          postEditorRef.current?.insertImageFiles(files);
        }}
        ref={postImageInputRef}
        type="file"
      />
      <Editor
        disabled={!isOwner}
        editorClassName="min-h-24"
        enableImagePasteDrop={isOwner}
        onChange={(value) => mutate({ value })}
        onUploadImage={uploadPostEditorImage}
        placeholder="Add description..."
        ref={postEditorRef}
        value={initialDescription.current}
      />
      {isOwner ? (
        <div className="flex justify-end">
          <Button
            className="rounded-full"
            onClick={() => postImageInputRef.current?.click()}
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

function PostDetailsActions({
  organizationId,
  postId,
}: {
  organizationId: string;
  postId: string;
}) {
  const { data: upvotes } = useLiveSuspenseQuery(
    (q) => {
      return q
        .from({ upvote: upvoteCollection })
        .where(({ upvote }) =>
          and(
            eq(upvote.organizationId, organizationId),
            eq(upvote.postId, postId)
          )
        );
    },
    [organizationId, postId]
  );

  const { data: postReactions } = useLiveSuspenseQuery(
    (q) => {
      return q
        .from({ postReaction: postReactionCollection })
        .where(({ postReaction }) =>
          and(
            eq(postReaction.organizationId, organizationId),
            eq(postReaction.postId, postId)
          )
        )
        .orderBy((postReaction) => postReaction.postReaction.emoji, "asc")
        .orderBy((postReaction) => postReaction.postReaction.createdAt, "asc");
    },
    [organizationId, postId]
  );

  return (
    <div className="flex items-center justify-between py-1">
      <PostReactionSection
        organizationId={organizationId}
        postId={postId}
        postReactions={postReactions}
      />
      <PostUpvoteButton
        organizationId={organizationId}
        postId={postId}
        upvotes={upvotes}
      />
    </div>
  );
}

function PostCommentComposer({
  organizationId,
  postId,
}: {
  organizationId: string;
  postId: string;
}) {
  const editorRef = useRef<EditorHandle | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const { data: session } = authClient.useSession();

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
      try {
        const userId = session?.user?.id;
        const userName = session?.user?.name;

        if (!(userId && userName)) {
          throw new Error("User not found");
        }

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
          editorClassName="min-h-10 px-1 py-1 [&_p]:my-0 mb-7"
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

function PostDetailsHeader({
  boardName,
  boardSlug,
  organizationId,
  title,
  postId,
  postCreatorId,
}: {
  boardName: string;
  boardSlug: string;
  organizationId: string;
  title: string;
  postId: string;
  postCreatorId: string | null;
}) {
  const { allowed: isOwner } = usePolicy(
    allPolicy(hasMembership(organizationId), isUser(postCreatorId ?? ""))
  );

  const mutate = usePacedMutations<{ value: string }>({
    onMutate: ({ value }) => {
      // Apply optimistic update immediately
      postCollection.update(postId, (draft) => {
        draft.title = value;
      });
    },
    mutationFn: async ({ transaction }) => {
      // Persist the final merged state to the backend
      const mutation = transaction.mutations[0];
      const { modified: updatedPost } = mutation;
      const validatedPost = UpdatedPostSchema.parse(updatedPost);
      await fetchRpc((rpc) => rpc.PostUpdate(validatedPost));
    },
    // Wait 500ms after the last change before persisting
    strategy: debounceStrategy({ wait: 500 }),
  });

  const handleChange = (value: string) => {
    // Multiple rapid changes merge into a single transaction

    if (value.trim() === "") {
      toastManager.add({ title: "Title is required", type: "error" });
      return;
    }
    mutate({ value });
  };
  return (
    <div className="space-y-3">
      <Link
        className="inline-block text-muted-foreground text-xs underline-offset-4 hover:underline"
        params={{ organizationId, boardSlug }}
        to="/$organizationId/board/$boardSlug"
      >
        Back to {boardName}
      </Link>

      <PostTitleInput
        defaultValue={title}
        onChange={isOwner ? (e) => handleChange(e.target.value) : undefined}
        readOnly={!isOwner}
      />
    </div>
  );
}

function PostUpvoteButton({
  organizationId,
  postId,
  upvotes,
}: {
  organizationId: string;
  postId: string;
  upvotes: PostUpvote[];
}) {
  const { data: session } = authClient.useSession();
  const [isToggling, setIsToggling] = useState(false);
  const currentUserId = session?.user?.id;
  const currentUpvote = upvotes.find(
    (upvote) => upvote.userId === currentUserId
  );
  const upvoteCount = upvotes.length;

  const handleToggleUpvote = async () => {
    if (!currentUserId) {
      toastManager.add({ title: "Sign in to upvote", type: "error" });
      return;
    }

    try {
      setIsToggling(true);
      if (currentUpvote) {
        const tx = upvoteCollection.delete(currentUpvote.id);
        await tx.isPersisted.promise;
      } else {
        const tx = upvoteCollection.insert({
          id: generateId("upvote"),
          createdAt: new Date(),
          updatedAt: new Date(),
          organizationId,
          postId,
          userId: currentUserId,
          memberId: null,
        });
        await tx.isPersisted.promise;
      }
    } catch (_error) {
      toastManager.add({ title: "Failed to update upvote", type: "error" });
    } finally {
      setIsToggling(false);
    }
  };

  return (
    <Button
      className="rounded-full"
      disabled={isToggling}
      onClick={handleToggleUpvote}
      size="sm"
      type="button"
      variant={currentUpvote ? "default" : "outline"}
    >
      <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
      <span>{upvoteCount}</span>
    </Button>
  );
}

function PostCommentList({
  organizationId,
  postId,
}: {
  organizationId: string;
  postId: string;
}) {
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id ?? "unknown";
  const store = useCommentDeleteDialogContext();

  const { data: comments } = useLiveSuspenseQuery(
    (q) => {
      return q
        .from({ comment: commentCollection })
        .where(({ comment }) =>
          and(
            eq(comment.organizationId, organizationId),
            eq(comment.postId, postId)
          )
        )
        .orderBy((comment) => comment.comment.createdAt, "desc");
    },
    [organizationId, postId]
  );

  const { data: commentReactions } = useLiveSuspenseQuery(
    (q) => {
      return q
        .from({ commentReaction: commentReactionCollection })
        .where(({ commentReaction }) =>
          and(
            eq(commentReaction.organizationId, organizationId),
            eq(commentReaction.postId, postId)
          )
        )
        .orderBy(
          (commentReaction) => commentReaction.commentReaction.commentId,
          "asc"
        )
        .orderBy(
          (commentReaction) => commentReaction.commentReaction.emoji,
          "asc"
        )
        .orderBy(
          (commentReaction) => commentReaction.commentReaction.createdAt,
          "asc"
        );
    },
    [organizationId, postId]
  );

  if (comments.length === 0) {
    return null;
  }

  return (
    <ItemGroup>
      {comments.map((comment) => (
        <Item
          className="rounded-xl border-border/80 px-4 py-3"
          key={comment.id}
          variant="outline"
        >
          <ItemMedia
            className="size-6 rounded-full bg-blue-500 text-white text-xs"
            variant="default"
          >
            {comment.user.name.charAt(0)}
          </ItemMedia>
          <ItemContent className="gap-2">
            <ItemHeader className="justify-start gap-2">
              <ItemTitle className="font-medium text-sm">
                {comment.user.name}
              </ItemTitle>
              <span className="text-muted-foreground text-sm">
                {formatRelativeTime(comment.createdAt)}
              </span>
            </ItemHeader>
            <ItemDescription className="line-clamp-none text-foreground">
              <div
                className={READONLY_RICH_TEXT_CLASS}
                dangerouslySetInnerHTML={{
                  __html: toRenderableRichTextHtml(comment.content),
                }}
              />
            </ItemDescription>
            <CommentReactionSection
              commentId={comment.id}
              commentReactions={commentReactions}
              organizationId={organizationId}
              postId={postId}
            />
          </ItemContent>
          {currentUserId === comment.userId && (
            <ItemActions className="self-start">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={(props) => (
                    <Button {...props} size="icon-sm" variant="ghost">
                      <HugeiconsIcon icon={MoreHorizontalIcon} />
                    </Button>
                  )}
                />

                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem>
                      <HugeiconsIcon icon={PencilEdit01Icon} />
                      Edit
                    </DropdownMenuItem>
                    {/* 
                  <DropdownMenuSeparator /> */}

                    <DropdownMenuItem
                      onClick={() =>
                        store.send({
                          type: "toggle",
                          data: { commentId: comment.id },
                        })
                      }
                    >
                      <HugeiconsIcon icon={Delete02Icon} />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </ItemActions>
          )}
        </Item>
      ))}
    </ItemGroup>
  );
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function formatRelativeTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  const diffMs = date.getTime() - Date.now();
  const diffSeconds = Math.round(diffMs / 1000);
  const diffMinutes = Math.round(diffMs / (1000 * 60));
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (Math.abs(diffSeconds) < 60) {
    return rtf.format(diffSeconds, "second");
  }
  if (Math.abs(diffMinutes) < 60) {
    return rtf.format(diffMinutes, "minute");
  }
  if (Math.abs(diffHours) < 24) {
    return rtf.format(diffHours, "hour");
  }
  return rtf.format(diffDays, "day");
}

function PostDetailsActionsSkeleton() {
  return (
    <div className="flex items-center justify-between py-1">
      <Skeleton className="h-8 w-20 rounded-full" />
      <Skeleton className="h-8 w-16 rounded-full" />
    </div>
  );
}

function PostCommentListSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
    </div>
  );
}

export const PostDetails = {
  Layout: PostDetailsLayout,
  Header: PostDetailsHeader,
  Description: PostDescriptionEditor,
  Actions: PostDetailsActions,
  ActionsSkeleton: PostDetailsActionsSkeleton,
  CommentComposer: PostCommentComposer,
  CommentList: PostCommentList,
  CommentListSkeleton: PostCommentListSkeleton,
};

export function PostDetailsFormSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <section className="space-y-6">
        <div className="space-y-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-3/5" />
        </div>

        <div className="flex justify-end">
          <Skeleton className="h-9 w-24 rounded-full" />
        </div>

        <Skeleton className="h-28 w-full" />

        <div className="py-1">
          <Separator />
        </div>

        <Skeleton className="h-24 w-full rounded-xl" />
      </section>
    </div>
  );
}
