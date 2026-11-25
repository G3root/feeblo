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

import {
  collectHeadings,
  type MarkdownHeading,
  rehypeHeadingIds,
} from "./heading-ids";
import { rehypeCodeHighlight } from "./rehype-code-highlight";
import { rehypeSafeUrlAttributes } from "./rehype-safe-urls";

export type { MarkdownHeading } from "./heading-ids";

/** An escaped underscore, which the Markdown renderer reads as emphasis. */
const escapedUnderscorePattern = /(^|[^\\])\\_/g;

const unescapeUnderscore = (str: string) => {
  return str.replace(escapedUnderscorePattern, "$1_");
};

export const htmlToMarkdown = (html: string): string => {
  const markdown = unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeRemark, { newlines: true })
    .use(remarkGfm)
    .use(remarkStringify)
    .processSync(html)
    .toString();

  return unescapeUnderscore(markdown);
};

export type MarkdownHtmlOptions = {
  /**
   * Anchor every heading and turn on the outline that links to it.
   *
   * Off by default: most bodies in this repo — changelog entries, feed items,
   * widget answers — have no outline beside them, and adding unused attributes
   * to their HTML would be a change with no reader on the other end.
   */
  readonly headingIds?: boolean;
};

export const markdownToHtml = (
  markdown: string,
  options: MarkdownHtmlOptions = {}
): string => {
  return getHtmlProcessor(options.headingIds === true)
    .processSync(markdown)
    .toString();
};

/**
 * The headings of a Markdown document, in document order.
 *
 * Read through the same pipeline that renders the page, so the ids here are the
 * ids in the HTML. Slugging the raw Markdown separately would be a second
 * parser with its own opinion about inline code, emphasis and duplicates; the
 * two agree until the first document where they do not.
 */
export const markdownHeadings = (markdown: string): MarkdownHeading[] => {
  const processor = getTreeProcessor();

  return collectHeadings(processor.runSync(processor.parse(markdown)));
};

/** Attach the heading plugin when an outline is going to read the tree. */
function addHeadingIds<
  Processor extends { use: (plugin: typeof rehypeHeadingIds) => Processor },
>(processor: Processor, headingIds: boolean): Processor {
  return headingIds ? processor.use(rehypeHeadingIds) : processor;
}

// The unified pipeline is built once and frozen for reuse: constructing it
// per call dominated feed/snapshot render latency. Processors are safe to
// share for synchronous `processSync` runs in a single-threaded isolate.
//
// `headingIds` is a second processor rather than a flag inside one: the
// heading plugin mutates the tree it is given, so the two variants cannot share
// an instance without the anchored pass leaking into the plain one.
function createHtmlProcessor(headingIds: boolean) {
  return addHeadingIds(
    unified().use(remarkParse).use(remarkGfm).use(remarkRehype),
    headingIds
  )
    .use(rehypeCodeHighlight)
    .use(rehypeSafeUrlAttributes)
    .use(rehypeStringify)
    .freeze();
}

/** The same pipeline, stopped before compilation so the tree can be read. */
function createTreeProcessor() {
  return addHeadingIds(
    unified().use(remarkParse).use(remarkGfm).use(remarkRehype),
    true
  ).freeze();
}

type HtmlProcessor = ReturnType<typeof createHtmlProcessor>;

/**
 * The processors are built at most once per isolate and kept inside this
 * closure: no other module can read or replace them, and a module that never
 * renders Markdown never pays for the pipeline.
 */
const getHtmlProcessor = (() => {
  const processors = new Map<boolean, HtmlProcessor>();

  return (headingIds: boolean): HtmlProcessor => {
    const cached = processors.get(headingIds);

    if (cached !== undefined) {
      return cached;
    }

    const processor = createHtmlProcessor(headingIds);
    processors.set(headingIds, processor);

    return processor;
  };
})();

const getTreeProcessor = (() => {
  let processor: ReturnType<typeof createTreeProcessor> | null = null;

  return (): ReturnType<typeof createTreeProcessor> => {
    processor ??= createTreeProcessor();

    return processor;
  };
})();

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
