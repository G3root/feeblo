import { useEditorState } from "@tiptap/react";
import { setTextAlignment } from "../../utils/set-text-alignment";
import { AlignRightIcon } from "../icons";
import { useBubbleMenuContext } from "./context";
import type { PreWiredItemProps } from "./create-mark-bubble-item";
import { BubbleMenuItem } from "./item";

export function BubbleMenuAlignRight({
  className,
  children,
}: PreWiredItemProps) {
  const { editor } = useBubbleMenuContext();

  const isActive = useEditorState({
    editor,
    selector: ({ editor }) => editor?.isActive({ alignment: "right" }) ?? false,
  });

  return (
    <BubbleMenuItem
      className={className}
      isActive={isActive}
      name="align-right"
      onCommand={() => setTextAlignment(editor, "right")}
    >
      {children ?? <AlignRightIcon />}
    </BubbleMenuItem>
  );
}
