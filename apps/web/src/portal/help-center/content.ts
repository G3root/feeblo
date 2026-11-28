import type { THelpCenterArticlePublicSummary } from "@feeblo/domain/help-center-article/schema";
import type { THelpCenterTopicPublic } from "@feeblo/domain/help-center-topic/schema";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import { m } from "@/paraglide/messages.js";

/**
 * The shapes the portal's help center navigation works on.
 *
 * Declared from the RPC projections rather than restated, so a field the server
 * stops sending is a type error here instead of an `undefined` in a rail.
 */
export type HelpCenterNavArticle = Pick<
  THelpCenterArticlePublicSummary,
  "excerpt" | "id" | "isArchived" | "slug" | "title" | "topicId"
>;

/**
 * The section that holds articles whose section is not published.
 *
 * A section with only archived articles is not listed on the portal — the
 * public topic read requires a published article — while its articles are still
 * readable, so the tree needs somewhere to put them. Named rather than numeric
 * because the key is rendered as a `data-` attribute and read by the tests.
 */
export const UNLISTED_SECTION_KEY = "unlisted";

export type HelpCenterNavSection = {
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly icon: string | null;
  readonly articles: ReadonlyArray<HelpCenterNavArticle>;
  /**
   * Whether this is a published topic or the bucket that catches articles whose
   * topic is not listed. The bucket has no icon of its own, so the tree draws a
   * generic one instead of borrowing the default topic icon.
   */
  readonly isTopic: boolean;
};

/**
 * The nav tree: one section per topic, in the order the server sent them.
 *
 * Order is the server's, not this function's: `ListHelpCenterTopicsPublic`
 * already sorts by the workspace's own `position`, and re-sorting here would be
 * a second opinion about the order a workspace chose.
 */
export function buildHelpCenterSections({
  topics,
  articles,
}: {
  readonly topics: ReadonlyArray<THelpCenterTopicPublic>;
  readonly articles: ReadonlyArray<HelpCenterNavArticle>;
}): ReadonlyArray<HelpCenterNavSection> {
  const byTopic = new Map<string, HelpCenterNavArticle[]>();

  for (const article of articles) {
    const bucket = byTopic.get(article.topicId);

    if (bucket === undefined) {
      byTopic.set(article.topicId, [article]);
    } else {
      bucket.push(article);
    }
  }

  const listed = new Set(topics.map((topic) => topic.id));

  const sections: HelpCenterNavSection[] = topics.map((topic) => ({
    articles: byTopic.get(topic.id) ?? [],
    description: topic.description,
    icon: topic.icon,
    isTopic: true,
    key: topic.id,
    name: topic.name,
  }));

  const unlisted = articles.filter((article) => !listed.has(article.topicId));

  if (unlisted.length > 0) {
    sections.push({
      articles: unlisted,
      description: null,
      icon: null,
      isTopic: false,
      key: UNLISTED_SECTION_KEY,
      name: m.same_quaint_polecat_coax(),
    });
  }

  return sections;
}

/**
 * The list's own row for one URL, if the list has it yet.
 *
 * The detail read and the list read arrive independently, and the rails need a
 * row — an id to mark, a topic to open — before the body does. Falling back to
 * the list is what lets the navigation stay mounted while an article loads.
 */
export function findHelpCenterArticleBySlug(
  articles: ReadonlyArray<HelpCenterNavArticle>,
  slug: string
): HelpCenterNavArticle | undefined {
  return articles.find((article) => article.slug === slug);
}

/**
 * Where one article sits in the tree, and what comes before and after it.
 *
 * A named shape rather than an inline one because three call sites read
 * different fields of it — the breadcrumb wants the section, the footer wants
 * the neighbours — and each of them reading `undefined` for the same reason is
 * the contract worth naming.
 */
export type HelpCenterSiblings = {
  readonly section: HelpCenterNavSection | undefined;
  readonly index: number;
  readonly previous: HelpCenterNavArticle | undefined;
  readonly next: HelpCenterNavArticle | undefined;
};

/**
 * The section a reader is in, and its neighbours.
 *
 * One pass over the tree the rails already built, so the article page, the
 * breadcrumb and the next/previous links cannot disagree about where an article
 * sits.
 */
export function findHelpCenterSiblings({
  sections,
  articleId,
}: {
  readonly sections: ReadonlyArray<HelpCenterNavSection>;
  readonly articleId: string;
}): HelpCenterSiblings {
  for (const section of sections) {
    const index = section.articles.findIndex(
      (article) => article.id === articleId
    );

    if (index === -1) {
      continue;
    }

    return {
      index,
      next: section.articles[index + 1],
      previous: section.articles[index - 1],
      section,
    };
  }

  return {
    index: -1,
    next: undefined,
    previous: undefined,
    section: undefined,
  };
}

/** Fenced code blocks, which are read faster than prose and are not sentences. */
const FENCED_CODE_BLOCK = /^```[\s\S]*?^```/gm;

const WORD = /\S+/g;

/**
 * Reading time in whole minutes, never less than one.
 *
 * Counted from the Markdown source rather than the rendered text because the
 * page that shows the number does not render the body before the reader arrives
 * at it; the estimate only has to be close enough not to be wrong, and ~200
 * words a minute is the usual figure for technical prose.
 */
export function readingMinutes(content: string): number {
  const words =
    content.replace(FENCED_CODE_BLOCK, " ").match(WORD)?.length ?? 0;

  return Math.max(1, Math.round(words / 200));
}

/**
 * The date style the page shows.
 *
 * The locale is not this module's to choose: the page renders in the reader's
 * Paraglide locale, and a formatter created without one falls back to the host's
 * default (`en-US` on a server, the browser's language on the client), which
 * would print a different month and order than the copy around it.
 */
const DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

/**
 * One formatter per locale, built on first use.
 *
 * `toLocaleDateString()` with an options object, and a formatter created per
 * call, both rebuild the `Intl.DateTimeFormat`; an article page formats a date
 * at least once per render. The map keeps one per locale — across a locale
 * switch the reader gets a second formatter, not a new one per render — and the
 * number of locales is bounded by the catalog.
 */
const DATE_FORMATS = new Map<string, Intl.DateTimeFormat>();

const dateFormatFor = (locale: string): Intl.DateTimeFormat => {
  const existing = DATE_FORMATS.get(locale);

  if (existing !== undefined) {
    return existing;
  }

  const created = new Intl.DateTimeFormat(locale, DATE_FORMAT_OPTIONS);

  DATE_FORMATS.set(locale, created);

  return created;
};

export function formatHelpDate(value: Date | string, locale: string): string {
  return dateFormatFor(locale).format(
    value instanceof Date ? value : new Date(value)
  );
}

/**
 * Whether an atom query's failure cause carries the typed not-found error.
 *
 * `AsyncResult.builder.onFailure` hands the whole `Cause`, so matching the
 * tagged error directly never sees it. Pull the first declared failure out
 * before asking for the tag; a cause with no typed failure is not "missing".
 */
export function isHelpCenterArticleNotFound(
  cause: Cause.Cause<unknown>
): boolean {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause));

  return error !== undefined && Predicate.isTagged(error, "NotFoundError");
}
