import { Editor } from "@feeblo/ui/editor";
import { EditorProvider } from "@feeblo/ui/editor/editor-store";

import { useCommentComposer } from "./context";

export function CommentComposerEditor() {
  const { actions, state } = useCommentComposer();

  return (
    <EditorProvider
      defaultValue={{ postContent: state.content }}
      key={state.resetKey}
    >
      <Editor
        className="text-sm"
        minimal
        onChange={(doc) => actions.onContentChange(doc)}
        placeholder={state.placeholder}
        readOnly={state.disabled}
      />
    </EditorProvider>
  );
}