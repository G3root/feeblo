import { PostReactionPicker } from "../v2/reaction-picker";
import { UpvoteButton } from "../v2/upvote-toggle";

export function PostDetailsEngagementBar({
  disabled = false,
  postId,
}: {
  disabled?: boolean;
  postId: string;
}) {
  return (
    <>
      <PostReactionPicker disabled={disabled} postId={postId} />

      <UpvoteButton disabled={disabled} postId={postId} />
    </>
  );
}
