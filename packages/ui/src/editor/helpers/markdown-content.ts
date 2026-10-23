// SPDX-License-Identifier: AGPL-3.0
// This file contains code adapted from hey-1 (https://github.com/slymnoyann/hey-1),
// which is licensed under the GNU General Public License v3.0.
// Copyright (C) 2024 Slymn Oyan
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { htmlToMarkdown } from "@feeblo/utils/markdown";
import type { Editor } from "prosekit/core";
import { htmlFromNode } from "prosekit/core";
import { ListDOMSerializer } from "prosekit/extensions/list";

import type { EditorExtension } from "../extension";

export const getMarkdownContent = (editor: Editor<EditorExtension>): string => {
  if (!editor.mounted) {
    return "";
  }

  const { doc } = editor.view.state;
  const html = htmlFromNode(doc, { DOMSerializer: ListDOMSerializer });
  return htmlToMarkdown(html);
};
