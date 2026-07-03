import { PostCommentComposer } from "@feeblo/post-ui/post-comment-composer";

import { PostEditableContent } from "@feeblo/post-ui/post-content";
import { PostDetailsEngagementBar } from "@feeblo/post-ui/post-engagement-bar";
import { PostTitleUpdateInput } from "@feeblo/post-ui/post-title-input";
import { Separator } from "@feeblo/ui/separator";
import { Skeleton } from "@feeblo/ui/skeleton";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

function PostDetailsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <section className="space-y-6">{children}</section>
    </div>
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
  return (
    <div className="space-y-3">
      <Link
        className="inline-block text-muted-foreground text-xs underline-offset-4 hover:underline"
        params={{ organizationId, boardSlug }}
        to="/$organizationId/board/$boardSlug"
      >
        Back to {boardName}
      </Link>

      <PostTitleUpdateInput
        defaultValue={title}
        postCreatorId={postCreatorId}
        postId={postId}
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
