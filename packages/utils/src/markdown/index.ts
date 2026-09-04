// SPDX-License-Identifier: AGPL-3.0
// This file contains code adapted from hey-1 (https://github.com/slymnoyann/hey-1),
// which is licensed under the GNU General Public License v3.0.
// Copyright (C) 2024 Slymn Oyan
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { TTLCache } from "@isaacs/ttlcache";
import rehypeParse from "rehype-parse";
import rehypeRemark from "rehype-remark";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

import { rehypeCodeHighlight } from "./rehype-code-highlight";
import { rehypeJoinParagraph } from "./rehype-join-paragraph";
import { customBreakHandler } from "./remark-break-handler";

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
  return getHtmlProcessor().processSync(markdown).toString();
};

// The unified pipeline is built once and frozen for reuse: constructing it
// per call dominated feed/snapshot render latency. Processors are safe to
// share for synchronous `processSync` runs in a single-threaded isolate.
function createHtmlProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeCodeHighlight)
    .use(rehypeStringify)
    .freeze();
}

type HtmlProcessor = ReturnType<typeof createHtmlProcessor>;

let htmlProcessor: HtmlProcessor | null = null;

function getHtmlProcessor(): HtmlProcessor {
  if (!htmlProcessor) {
    htmlProcessor = createHtmlProcessor();
  }
  return htmlProcessor;
}

// Isolate-local memo for rendered Markdown HTML (RSS feeds, SEO snapshots).
// Callers key by a content version (e.g. `${id}:${updatedAt}`) so edits
// re-render; TTL bounds staleness for keys callers reuse across edits.
// `@isaacs/ttlcache` handles expiry plus LRU eviction across organizations.
const HTML_CACHE_TTL_MS = 5 * 60 * 1_000;
// 200 entries: a single feed holds at most PUBLIC_CHANGELOG_LIMIT (100)
// entries, so this covers hot feeds across organizations on an isolate
// without risking worker memory (values are rendered HTML strings, KBs
// each — low single-digit MB in practice).
const HTML_CACHE_MAX_ENTRIES = 200;

const htmlCache = new TTLCache<string, string>({
  max: HTML_CACHE_MAX_ENTRIES,
  ttl: HTML_CACHE_TTL_MS,
});

export const markdownToHtmlCached = (
  key: string,
  markdown: string,
  ttlMs: number = HTML_CACHE_TTL_MS
): string => {
  const cached = htmlCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const html = markdownToHtml(markdown);
  htmlCache.set(key, html, { ttl: ttlMs });
  return html;
};
