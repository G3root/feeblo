// SPDX-License-Identifier: AGPL-3.0
// This file contains code adapted from hey-1 (https://github.com/slymnoyann/hey-1),
// which is licensed under the GNU General Public License v3.0.
// Copyright (C) 2024 Slymn Oyan
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { useDebouncedCallback } from "@tanstack/react-pacer";
import type { Editor } from "prosekit/core";
import { useDocChange } from "prosekit/react";
import { useCallback, useState } from "react";

import { useEditorContext } from "../editor-store";
import type { EditorExtension } from "../extension";
import { getMarkdownContent } from "../helpers/markdown-content";

const DEBOUNCE_CHARS_THRESHOLD = 3000;
const DEBOUNCE_DELAY = 500;

const useContentChange = (
  editor: Editor<EditorExtension>,
  setPostContent?: (markdown: string) => void
) => {
  const store = useEditorContext();
  const [largeDocument, setLargeDocument] = useState(false);

  const updatePostContent = useCallback(
    (markdown: string) => {
      setLargeDocument(markdown.length > DEBOUNCE_CHARS_THRESHOLD);
      setPostContent?.(markdown);
      store.send({ type: "setPostContent", postContent: markdown });
    },
    [setPostContent]
  );

  const serializeContent = useCallback(() => {
    const markdown = getMarkdownContent(editor);
    updatePostContent(markdown);
  }, [editor, updatePostContent]);

  // Only large documents are debounced. The debouncer schedules via
  // `setTimeout` even at `wait: 0`, and its pending timer can outlive a
  // component re-mount (e.g. the comment composer resets its editor after a
  // submit), firing late with a stale document and clobbering the next
  // comment. Small documents propagate synchronously instead, so the doc
  // change order is deterministic (mount-empty, then typed content).
  const debouncedSetContent = useDebouncedCallback(serializeContent, {
    wait: DEBOUNCE_DELAY,
  });

  useDocChange(largeDocument ? debouncedSetContent : serializeContent, {
    editor,
  });
};

export default useContentChange;
