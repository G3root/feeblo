// SPDX-License-Identifier: AGPL-3.0
// This file contains code adapted from hey-1 (https://github.com/slymnoyann/hey-1),
// which is licensed under the GNU General Public License v3.0.
// Copyright (C) 2024 Slymn Oyan
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import type { Editor } from "prosekit/core";
import { htmlFromNode, nodeFromHTML } from "prosekit/core";
import { ListDOMSerializer } from "prosekit/extensions/list";
import type { EditorExtension } from "../extension";
import { htmlToMarkdown, markdownToHtml } from "@feeblo/utils/markdown";

export const getMarkdownContent = (editor: Editor<EditorExtension>): string => {
  if (!editor.mounted) {
    return "";
  }

  const { doc } = editor.view.state;
  const html = htmlFromNode(doc, { DOMSerializer: ListDOMSerializer });
  return htmlToMarkdown(html);
};

export const setMarkdownContent = (
  editor: Editor<EditorExtension>,
  markdown: string
): void => {
  if (!editor.mounted) {
    return;
  }

  const html = markdownToHtml(markdown);
  const { view } = editor;
  const { state } = view;
  const doc = nodeFromHTML(html, { schema: state.schema });
  view.dispatch(state.tr.replaceWith(0, state.doc.content.size, doc.content));
};
