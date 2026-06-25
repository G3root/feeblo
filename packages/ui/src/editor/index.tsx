import "./editor.css";

import {
  Editor as SharedEditor,
  type EditorProps as SharedEditorProps,
  type EmailEditorRef as SharedEmailEditorRef,
} from "@feeblo/editor";

export type EditorProps = SharedEditorProps;
export type EmailEditorRef = SharedEmailEditorRef;

export function Editor(props: SharedEditorProps) {
  return <SharedEditor {...props} />;
}
