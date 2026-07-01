import "prosekit/basic/style.css";
import "prosekit/basic/typography.css";

import { createEditor, type NodeJSON } from "prosekit/core";
import { ProseKit, useDocChange } from "prosekit/react";
import { useMemo } from "react";
import { cn } from "../utils";
import { defineExtension } from "./extension";
import { tags } from "./sample/sample-tag-data";
import { users } from "./sample/sample-user-data";
import { InlineMenu } from "./ui/inline-menu/index";
import { SlashMenu } from "./ui/slash-menu/index";
import { TableHandle } from "./ui/table-handle/index";
import { TagMenu } from "./ui/tag-menu/index";
import { UserMenu } from "./ui/user-menu/index";

export interface EditorProps {
  className?: string;
  defaultContent?: NodeJSON;
  onChange?: (doc: NodeJSON) => void;
  placeholder?: string;
  readonly?: boolean;
}

export function Editor(props: EditorProps) {
  const defaultContent = props.defaultContent ?? "";
  const editor = useMemo(() => {
    const extension = defineExtension({
      placeholder: props.placeholder,
      readonly: props.readonly,
    });
    return createEditor({
      extension,
      ...(defaultContent ? { defaultContent } : {}),
    });
  }, [props.placeholder, props.readonly, defaultContent]);

  useDocChange(
    () => {
      const json = editor.getDocJSON();
      if (props.onChange) {
        props.onChange(json);
      }
    },
    { editor }
  );

  return (
    <ProseKit editor={editor}>
      <div
        className={cn(
          'ProseMirror box-border min-h-full px-0 outline-none outline-0 [&_span[data-mention="tag"]]:text-violet-500'
        )}
        ref={editor.mount}
      />
      <InlineMenu />
      <SlashMenu />
      <UserMenu users={users} />
      <TagMenu tags={tags} />
      {/* <BlockHandle /> */}
      <TableHandle />
      {/* <DropIndicator /> */}
    </ProseKit>
  );
}
