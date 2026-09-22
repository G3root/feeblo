import { useState } from "react";

import { m } from "../../paraglide/messages.js";
import { CommentComposer } from "../comment-composer";
import { useCommentDisplay } from "./context";

export function CommentDisplayEditForm() {
  const { actions, state } = useCommentDisplay();
  const [content, setContent] = useState(state.content);
  const [isPrivate, setIsPrivate] = useState(state.isInternal);

  return (
    <div className="mt-2">
      <CommentComposer
        content={content}
        isPrivate={isPrivate}
        onCancel={actions.onCancelEdit}
        onContentChange={setContent}
        onSubmit={({
          content: submittedContent,
          isPrivate: submittedIsPrivate,
        }) => {
          // The comment body updates optimistically, so close the editor in
          // the same tick; the host surfaces persistence failures.
          void actions.onUpdate({
            content: submittedContent,
            isPrivate: submittedIsPrivate,
          });
          actions.onCancelEdit();
        }}
        onVisibilityChange={setIsPrivate}
        showVisibilityToggle={false}
        submitLabel={m.weary_drab_falcon()}
      />
    </div>
  );
}
