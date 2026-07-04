// SPDX-License-Identifier: AGPL-3.0
// This file contains code adapted from hey-1 (https://github.com/slymnoyann/hey-1),
// which is licensed under the GNU General Public License v3.0.
// Copyright (C) 2024 Slymn Oyan
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import "prosekit/basic/style.css";
import "prosekit/basic/typography.css";
import { markdownToHtml } from "@feeblo/utils/markdown";
import { createEditor } from "prosekit/core";
import { ProseKit } from "prosekit/react";
import { useMemo } from "react";
import { cn } from "../utils";
import { useEditorContext } from "./editor-store";
import { defineExtension } from "./extension";
import useContentChange from "./hooks/use-content-change";
import { BlockHandle } from "./ui/block-handle";
import { DropIndicator } from "./ui/drop-indicator";
import { InlineMenu } from "./ui/inline-menu/index";
import { SlashMenu } from "./ui/slash-menu/index";
import { TableHandle } from "./ui/table-handle/index";

export interface EditorProps {
  className?: string;
  minimal?: boolean;
  onChange?: (doc: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  showBlockHandle?: boolean;
}

export function Editor(props: EditorProps) {
  const store = useEditorContext();

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  const defaultContent = useMemo(() => {
    const markdown = store.get().context.postContent;
    return markdown ? markdownToHtml(markdown) : undefined;
  }, []);

  const editor = useMemo(() => {
    const extension = defineExtension({
      placeholder: props.placeholder,
      readonly: props.readOnly,
    });
    return createEditor({
      extension,
      ...(defaultContent ? { defaultContent } : {}),
    });
  }, [props.placeholder, props.readOnly, defaultContent]);

  useContentChange(editor, props.onChange);

  return (
    <ProseKit editor={editor}>
      <div
        className={cn(
          'ProseMirror box-border min-h-full px-0 outline-none outline-0 [&_span[data-mention="tag"]]:text-violet-500'
        )}
        ref={editor.mount}
      />
      {props.readOnly || props.minimal ? null : (
        <>
          <InlineMenu />
          <SlashMenu />
          <TableHandle />
          <DropIndicator />
          {props.showBlockHandle ? <BlockHandle /> : null}
          {/* <UserMenu users={users} /> */}
        </>
      )}
    </ProseKit>
  );
}

// biome-ignore lint/performance/noBarrelFile: <explanation>
export { EditorProvider, useEditorContext } from "./editor-store";
