import { Editor } from "@feeblo/ui/editor";
import { EditorProvider } from "@feeblo/ui/editor/editor-store";
import type { Editor as ProseKitEditor } from "prosekit/core";
import { useCallback, useRef, useState } from "react";

import {
  useCommentComposer,
  useCommentComposerIsDisabled,
  useCommentComposerPlaceholder,
} from "./context";
import { useCommentComposerStore } from "./store";

// An empty doc: a single empty paragraph with the cursor at the start.
const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

export function CommentComposerEditor() {
  const { actions } = useCommentComposer();
  const store = useCommentComposerStore();
  const isDisabled = useCommentComposerIsDisabled();
  const placeholder = useCommentComposerPlaceholder();
  // The editor captures its initial document once at mount; later text edits
  // live in ProseKit. This must NOT subscribe to `content` — every keystroke
  // dispatches `contentChanged`, and subscribing would re-render the editor
  // (and remount its subtree props) on each one.
  const [initialContent] = useState(() => store.get().context.content);
  // The last resetKey the attached document was cleared for. A bump means a
  // submit (or a host-driven resetKey change) requested a clear — exactly one
  // clear must be applied per bump.
  const lastAppliedResetKey = useRef(store.get().context.resetKey);
  // Store subscription for the currently attached editor instance. Kept in a
  // ref so detaching the instance (or attaching a fresh one) drops it.
  const storeSubscription = useRef<{ unsubscribe(): void } | null>(null);

  // The Editor hands us the live ProseKit instance on attach and null on
  // detach. Reset requests are store events (`submitted` and the host
  // resetKey mirror bump `resetKey`), so instead of mirroring the counter
  // into React state and reacting in an effect, the editor subscribes to the
  // store directly against the editor's own lifecycle: the clear fires
  // synchronously with the event that requested it (before the next paint),
  // and the editor never re-renders for a reset.
  const handleEditorRef = useCallback(
    (editor: ProseKitEditor | null) => {
      storeSubscription.current?.unsubscribe();
      storeSubscription.current = null;

      if (!editor) {
        return;
      }

      // Clear the document in place instead of re-mounting the editor: a
      // fresh ProseKit instance initializes asynchronously, so keystrokes
      // typed right after posting a comment could be dropped by the
      // not-yet-ready editor, while text typed just before a remount would
      // be wiped entirely.
      const applyResetIfRequested = () => {
        const { resetKey } = store.get().context;
        if (resetKey === lastAppliedResetKey.current) {
          return;
        }
        lastAppliedResetKey.current = resetKey;
        editor.setContent(EMPTY_DOC, "start");
      };
      // Catch up on a reset that was requested while no editor was attached
      // (e.g. while a fresh instance was initializing), then keep applying
      // every later one.
      applyResetIfRequested();
      storeSubscription.current = store.subscribe(applyResetIfRequested);
    },
    [store]
  );

  return (
    <EditorProvider defaultValue={{ postContent: initialContent }}>
      <Editor
        className="text-sm"
        editorRef={handleEditorRef}
        minimal
        onChange={actions.onContentChange}
        placeholder={placeholder}
        readOnly={isDisabled}
      />
    </EditorProvider>
  );
}