import "./editor.css";

import {
  Editor as SharedEditor,
  type EditorProps as SharedEditorProps,
} from "@feeblo/editor";

export function Editor(props: SharedEditorProps) {
  return <SharedEditor {...props} />;
}
