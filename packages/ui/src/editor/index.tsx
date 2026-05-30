import "./editor.css";

import {
  Editor as SharedEditor,
  type EmailEditorRef as SharedEmailEditorRef,
  type EditorProps as SharedEditorProps,
} from "@feeblo/editor";

export type EditorProps = SharedEditorProps;
export type EmailEditorRef = SharedEmailEditorRef;

export function Editor(props: SharedEditorProps) {
  return <SharedEditor {...props} />;
}
