import { Button } from "@feeblo/ui/button";
import { useState } from "react";

import { CommentComposer } from "../comment-composer";
import { usePostCollectionData } from "../post-page-context";
import { usePostCollections } from "../providers/post-collections-provider";
import { CommentReactionPicker } from "../reaction-picker";
import { useCommentDisplay } from "./context";
import { useCommentThread } from "./thread-context";

export function CommentDisplayActions() {
  const { actions, meta, state } = useCommentDisplay();
  const { isAuthenticated, isLocked, isMember } = usePostCollectionData();
  const { onAuthRequired } = usePostCollections();
  const thread = useCommentThread();
  const [isReplying, setIsReplying] = useState(false);

  if (state.isEditing) {
    return null;
  }

  const handleToggleReply = () => {
    // Guests get the sign-in flow instead of a composer they cannot submit,
    // mirroring the reaction picker's auth handling.
    if (!isReplying && !isAuthenticated) {
      onAuthRequired?.();
      return;
    }
    if (!isReplying) {
      // Replying from a collapsed thread must reveal where the reply lands:
      // expand the replies accordion before the composer opens.
      thread?.expandReplies();
    }
    setIsReplying((prev) => !prev);
  };

  return (
    <>
      <div className="flex items-center gap-1 pt-1">
        <Button
          disabled={state.disabled || isLocked}
          onClick={handleToggleReply}
          size="xs"
          type="button"
          variant="ghost"
        >
          {isReplying ? "Hide reply" : meta.replyLabel}
        </Button>
        <CommentReactionPicker
          commentId={state.commentId}
          disabled={state.disabled}
          postId={state.postId}
          postSlug={state.postSlug}
        />
      </div>

      {isReplying && (
        <div className="pt-1">
          <CommentComposer
            onSubmit={async (value) => {
              // Close the composer only when the reply actually persisted;
              // when authentication is required the host's onAuthRequired
              // fires instead and the draft stays in the composer.
              const created = await actions.onReply({
                content: value.content,
                isPrivate: value.isPrivate,
              });
              if (created) {
                setIsReplying(false);
              }
            }}
            placeholder={`Reply to ${state.authorName}...`}
            // A reply under an INTERNAL comment continues member-only
            // context: force it INTERNAL and hide the toggle (the policy
            // denies PUBLIC replies under an INTERNAL parent).
            isPrivate={state.isInternal ? true : undefined}
            showVisibilityToggle={isMember && !state.isInternal}
            submitLabel="Reply"
          />
        </div>
      )}
    </>
  );
}
