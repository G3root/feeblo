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
import "./typeset.css";
import { markdownToHtml } from "@feeblo/utils/markdown";
import { createEditor, type Editor as ProseKitEditor } from "prosekit/core";
import { definePlaceholder } from "prosekit/extensions/placeholder";
import { defineReadonly } from "prosekit/extensions/readonly";
import { ProseKit } from "prosekit/react";
import { useEffect, useMemo } from "react";

import { useIsomorphicLayoutEffect } from "../hooks/use-isomorphic-layout-effect";
import { cn } from "../utils";
import { useEditorContext } from "./editor-store";
import { DEFAULT_PLACEHOLDER, defineExtension } from "./extension";
import useContentChange from "./hooks/use-content-change";
import { BlockHandle } from "./ui/block-handle";
import { DropIndicator } from "./ui/drop-indicator";
import { InlineMenu } from "./ui/inline-menu/index";
import { SlashMenu } from "./ui/slash-menu/index";
import { TableHandle } from "./ui/table-handle/index";

export interface EditorProps {
  className?: string;
  deferUploads?: boolean;
  /** Receives the live ProseKit editor instance (null on unmount). */
  editorRef?: (editor: ProseKitEditor | null) => void;
  editorScope?: string;
  minimal?: boolean;
  onChange?: (doc: string) => void;
  organizationId?: string;
  placeholder?: string;
  readOnly?: boolean;
  showBlockHandle?: boolean;
}

export function Editor(props: EditorProps) {
  const store = useEditorContext();

  const defaultContent = useMemo(() => {
    const markdown = store.get().context.postContent;
    return markdown ? markdownToHtml(markdown) : undefined;
  }, []);

  // The editor instance is created once from the mount-time props. The
  // runtime-tunable props (placeholder, readOnly) are applied to the live
  // instance below instead: rebuilding the editor when they change would
  // discard the user's current draft.
  const editor = useMemo(() => {
    const extension = defineExtension({
      deferUploads: props.deferUploads,
      editorScope: props.editorScope,
      organizationId: props.organizationId,
    });
    return createEditor({
      extension,
      ...(defaultContent && { defaultContent }),
    });
  }, [
    props.deferUploads,
    props.editorScope,
    props.organizationId,
    defaultContent,
  ]);

  // Apply placeholder and readOnly through the live ProseKit instance. Both
  // are plain plugins, so `editor.use` reconfigures the state in place
  // (preserving the document) — no new editor instance is created.
  useIsomorphicLayoutEffect(() => {
    const disposePlaceholder = editor.use(
      definePlaceholder({
        placeholder: props.placeholder ?? DEFAULT_PLACEHOLDER,
      })
    );
    const disposeReadonly = props.readOnly
      ? editor.use(defineReadonly())
      : null;
    return () => {
      disposePlaceholder();
      disposeReadonly?.();
    };
  }, [editor, props.placeholder, props.readOnly]);

  useContentChange(editor, props.onChange);

  useEffect(() => {
    props.editorRef?.(editor);
    return () => props.editorRef?.(null);
  }, [editor, props.editorRef]);

  return (
    <ProseKit editor={editor}>
      <div
        aria-multiline="true"
        className={cn(
          'ProseMirror typeset [&_span[data-mention="tag"]]:text-primary box-border min-h-full px-0 outline-0 outline-none',
          props.className
        )}
        ref={editor.mount}
        role="textbox"
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

export { EditorProvider, useEditorContext } from "./editor-store";
export { finalizeEditorContent } from "./uploader";
