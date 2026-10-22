import { MarkdownContent } from "@feeblo/ui/markdown-content";

import { useCommentDisplay } from "./context";
import { CommentDisplayEditForm } from "./edit-form";

export function CommentDisplayBody() {
  const { state } = useCommentDisplay();

  if (state.isEditing) {
    return <CommentDisplayEditForm />;
  }

  return <MarkdownContent className="mt-0.5 text-sm" content={state.content} />;
}
