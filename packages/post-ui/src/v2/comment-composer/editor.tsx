import { Editor } from "@feeblo/ui/editor";
import { EditorProvider } from "@feeblo/ui/editor/editor-store";
import type { Editor as ProseKitEditor } from "prosekit/core";
import { useEffect, useRef, useState } from "react";

import { useCommentComposer } from "./context";

export function CommentComposerEditor() {
  const { actions, state } = useCommentComposer();
  const [editor, setEditor] = useState<ProseKitEditor | null>(null);
  const lastResetKey = useRef(state.resetKey);

  // Reset the document in place instead of re-mounting the editor: a fresh
  // ProseKit instance initializes asynchronously, so keystrokes typed right
  // after posting a comment could be dropped by the not-yet-ready editor,
  // while text typed just before a remount would be wiped entirely.
  useEffect(() => {
    if (state.resetKey === lastResetKey.current || !editor) {
      return;
    }
    lastResetKey.current = state.resetKey;
    editor.setContent(
      // An empty doc: a single empty paragraph with the cursor at the start.
      { type: "doc", content: [{ type: "paragraph" }] },
      "start"
    );
  }, [editor, state.resetKey]);

  return (
    <EditorProvider defaultValue={{ postContent: state.content }}>
      <Editor
        className="text-sm"
        editorRef={setEditor}
        minimal
        onChange={actions.onContentChange}
        placeholder={state.placeholder}
        readOnly={state.disabled}
      />
    </EditorProvider>
  );
}
