import { useState } from "react";

import { CommentComposer } from "../comment-composer";
import { CommentReactionPicker } from "../reaction-picker";
import { useCommentDisplay } from "./context";

export function CommentDisplayActions() {
  const { actions, state } = useCommentDisplay();
  const [isReplying, setIsReplying] = useState(false);

  if (state.isEditing) {
    return null;
  }

  return (
    <>
      <div className="flex items-center gap-1 pt-2">
        {/* <Button
          disabled={state.disabled}
          onClick={() => setIsReplying((prev) => !prev)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon icon={MailReply01Icon} />
          {isReplying ? "Hide reply" : meta.replyLabel}
        </Button> */}
        <CommentReactionPicker
          commentId={state.commentId}
          disabled={state.disabled}
          postId={state.postId}
          postSlug={state.postSlug}
        />
      </div>

      {isReplying && (
        <div className="pt-2">
          <CommentComposer
            onSubmit={async (value) => {
              await actions.onReply(value);
              setIsReplying(false);
            }}
          />
        </div>
      )}
    </>
  );
}