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
import { hasWindow } from "@feeblo/utils/runtime-kind";
import type { Editor } from "prosekit/core";
import { htmlFromNode } from "prosekit/core";
import { ListDOMSerializer } from "prosekit/extensions/list";

import type { EditorExtension } from "../extension";

/**
 * ProseMirror's image node is block-level, while Markdown renders a standalone
 * image inside a paragraph (`<p><img></p>`). Handing that HTML to the parser
 * leaves an empty paragraph before the image, which shows as a blank line in
 * the editor and round-trips into the saved Markdown. Unwrap image-only
 * paragraphs so the image is parsed as the block node it is.
 */
export const unwrapImageParagraphs = (html: string): string => {
  if (!hasWindow()) {
    return html;
  }

  const parsed = new DOMParser().parseFromString(html, "text/html");

  for (const paragraph of parsed.body.querySelectorAll("p")) {
    const [child] = paragraph.children;

    if (
      paragraph.children.length === 1 &&
      child?.tagName === "IMG" &&
      paragraph.textContent?.trim() === ""
    ) {
      paragraph.replaceWith(...paragraph.childNodes);
    }
  }

  return parsed.body.innerHTML;
};

export const getMarkdownContent = (editor: Editor<EditorExtension>): string => {
  if (!editor.mounted) {
    return "";
  }

  const { doc } = editor.view.state;
  const html = htmlFromNode(doc, { DOMSerializer: ListDOMSerializer });
  return htmlToMarkdown(html);
};
