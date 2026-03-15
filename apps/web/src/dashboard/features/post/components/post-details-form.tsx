import { debounceStrategy, usePacedMutations } from "@tanstack/react-db";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { z } from "zod";
import { Separator } from "~/components/ui/separator";
import { Skeleton } from "~/components/ui/skeleton";
import { toastManager } from "~/components/ui/toast";
import {
  allPolicy,
  anyPolicy,
  hasMembership,
  hasOwnerOrAdminRole,
  isUser,
  usePolicy,
} from "~/hooks/use-policy";
import { postCollection } from "~/lib/collections";
import { fetchRpc } from "~/lib/runtime";
import { PostCommentComposer } from "./post-comment-composer";
import { PostCommentList, PostCommentListSkeleton } from "./post-comment-list";
import { PostEditableContent } from "./post-content";
import { PostDetailsEngagementBar } from "./post-engagement-bar";
import { PostTitleInput } from "./post-title-input";

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
    anyPolicy(
      hasOwnerOrAdminRole(),
      allPolicy(hasMembership(organizationId), isUser(postCreatorId ?? ""))
    )
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

function PostDetailsActionsSkeleton() {
  return (
    <div className="flex items-center justify-between py-1">
      <Skeleton className="h-8 w-20 rounded-full" />
      <Skeleton className="h-8 w-16 rounded-full" />
    </div>
  );
}

export const PostDetails = {
  Layout: PostDetailsLayout,
  Header: PostDetailsHeader,
  Description: PostEditableContent,
  ActionsSkeleton: PostDetailsActionsSkeleton,
  CommentComposer: PostCommentComposer,
  CommentList: PostCommentList,
  CommentListSkeleton: PostCommentListSkeleton,
  EngagementBar: PostDetailsEngagementBar,
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
