import { Skeleton } from "@feeblo/ui/skeleton";

import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { usePostCollections } from "../v2/providers/post-collections-provider";
import { PostReactionPicker } from "../v2/reaction-picker";
import { UpvoteButton } from "../v2/upvote-toggle";

export function PostDetailsEngagementBar({
  disabled = false,
  organizationId,
  postId,
}: {
  disabled?: boolean;
  organizationId: string;
  postId: string;
}) {
  const {
    collections: { upvoteCollection },
  } = usePostCollections();
  const { data: session } = useAuthState();
  const { data: upvotes, isLoading: isUpvotesLoading } = useLiveQuery(
    (q) => {
      if (!postId) {
        return undefined;
      }
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

  const hasCurrentUserUpvoted =
    session?.user?.id != null
      ? upvotes?.some((upvote) => upvote.userId === session.user.id)
      : false;

  if (isUpvotesLoading) {
    return null;
  }

  //Todo:fix the upvote

  return (
    <>
      <PostReactionPicker disabled={disabled} postId={postId} />

      <UpvoteButton
        disabled={disabled}
        isUpvoted={!!hasCurrentUserUpvoted}
        postId={postId}
        upvoteCount={upvotes?.length ?? 0}
      />
    </>
  );
}

export function PostDetailsEngagementBarSkeleton() {
  return (
    <div className="flex items-center gap-2">
      <Skeleton className="h-8 w-16 rounded-full" />
      <Skeleton className="h-8 w-20 rounded-full" />
      <Skeleton className="h-8 w-24 rounded-full" />
      <Skeleton className="h-8 w-16 rounded-full" />
    </div>
  );
}
