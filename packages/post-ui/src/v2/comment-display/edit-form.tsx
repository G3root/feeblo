import { useState } from "react";

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
        onSubmit={async ({
          content: submittedContent,
          isPrivate: submittedIsPrivate,
        }) => {
          await actions.onUpdate({
            content: submittedContent,
            isPrivate: submittedIsPrivate,
          });
          actions.onCancelEdit();
        }}
        onVisibilityChange={setIsPrivate}
        showVisibilityToggle={false}
        submitLabel="Save"
      />
    </div>
  );
}
