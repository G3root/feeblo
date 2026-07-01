// SPDX-License-Identifier: AGPL-3.0
// This file contains code adapted from hey-1 (https://github.com/slymnoyann/hey-1),
// which is licensed under the GNU General Public License v3.0.
// Copyright (C) 2024 Slymn Oyan
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import rehypeParse from "rehype-parse";
import rehypeRemark from "rehype-remark";
import remarkGfm from "remark-gfm";
import remarkHtml from "remark-html";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { rehypeJoinParagraph } from "../plugins/rehype-join-paragaraph";
import { customBreakHandler } from "../plugins/remark-break-handler";

// By default, remark-stringify escapes underscores (i.e. "_" => "\_"). We want
// to disable this behavior so that we can have underscores in mention usernames.
const unescapeUnderscore = (str: string) => {
  return str.replace(/(^|[^\\])\\_/g, "$1_");
};

export const htmlToMarkdown = (html: string): string => {
  const markdown = unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeJoinParagraph)
    .use(rehypeRemark, { newlines: true })
    .use(remarkGfm)
    .use(remarkStringify, {
      handlers: { break: customBreakHandler, hardBreak: customBreakHandler },
    })
    .processSync(html)
    .toString();

  return unescapeUnderscore(markdown);
};

export const markdownToHtml = (markdown: string): string => {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkHtml)
    .processSync(markdown)
    .toString();
};
