import type { THelpCenterArticleState } from "@feeblo/domain-contracts/help-center-article";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import { slugify } from "@feeblo/utils/url";
import * as Effect from "effect/Effect";

import { BadRequestError } from "../rpc-errors";
import { isDraftHelpCenterArticle } from "./machine";

/**
 * The stored fields a create and an update both derive.
 *
 * Declared here rather than in the two handlers because the derivation is the
 * contract: the dashboard write and the future Public API write must produce
 * the same slug from the same title, the same sanitized Markdown from the same
 * body, and the same excerpt from the same rendering. Two copies would drift
 * on the first edge case.
 */
export interface NormalizedHelpCenterArticleWrite {
  readonly content: string;
  readonly excerpt: string;
  readonly publishedAt: Date | null;
  readonly slug: string;
  readonly status: THelpCenterArticleState;
  readonly title: string;
}

const fail = (message: string) => Effect.fail(new BadRequestError({ message }));

/**
 * Turn a write into the row's stored fields.
 *
 * - **The title is trimmed** because it is stored, slugified and shown; a
 *   trailing space that survives into a slug is a URL nobody can type back.
 * - **The slug is always `slugify`'s output**, from the supplied value or the
 *   title, so `UI Kit` and `ui-kit` cannot become two pages that look identical
 *   in a list. An empty result is refused rather than stored as a blank path
 *   segment.
 * - **The body is sanitized Markdown and the excerpt is derived from its
 *   rendering.** A help centre body is pasted from everywhere, and the
 *   sanitizer is what makes "copy as Markdown" and a future file sync safe to
 *   serve verbatim.
 * - **`publishedAt` follows the lifecycle.** A draft has no publication, so the
 *   column is cleared; a live or withdrawn article keeps the date it first
 *   went live unless the caller names one. Stamping "now" on every save would
 *   make a typo fix look like a new release to every reader who sorts by date.
 */
export const normalizeArticleWrite = (args: {
  readonly content: string;
  readonly now: Date;
  readonly previousPublishedAt: Date | null;
  readonly requestedPublishedAt: Date | null;
  readonly slug?: string | undefined;
  readonly status: THelpCenterArticleState;
  readonly title: string;
}) =>
  Effect.gen(function* () {
    const title = args.title.trim();

    if (title.length === 0) {
      return yield* fail("title must not be empty.");
    }

    const slug = slugify((args.slug ?? "").trim() || title);

    if (slug.length === 0) {
      return yield* fail("slug must contain at least one letter or number.");
    }

    const { sanitizedMarkdown, sanitizedHtml } = sanitizeMarkdown(args.content);

    const publishedAt = isDraftHelpCenterArticle(args.status)
      ? null
      : (args.requestedPublishedAt ?? args.previousPublishedAt ?? args.now);

    return {
      content: sanitizedMarkdown,
      excerpt: htmlToExcerpt(sanitizedHtml),
      publishedAt,
      slug,
      status: args.status,
      title,
    } satisfies NormalizedHelpCenterArticleWrite;
  });
