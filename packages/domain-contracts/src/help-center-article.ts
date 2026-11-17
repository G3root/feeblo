import * as S from "effect/Schema";

/**
 * The stored publication vocabulary of a help center article.
 *
 * Declared here rather than in `@feeblo/db` because four layers need the same
 * list and only this package is visible to all of them: the column type, the
 * lifecycle machine in `@feeblo/domain`, the Public API's DTOs, and the
 * dashboard bundle. `help-center-article/machine.ts` derives its states from
 * this constant, so the graph and the column cannot drift.
 *
 * `archived` is a real reader-visible state, not a soft-delete: an article
 * describing a removed feature must stop being documented while the inbound
 * link still resolves to a page that says so.
 */
export const HELP_CENTER_ARTICLE_STATES = [
  "draft",
  "published",
  "archived",
] as const;

export const HelpCenterArticleState = S.Literals(HELP_CENTER_ARTICLE_STATES);

export type THelpCenterArticleState = S.Schema.Type<
  typeof HelpCenterArticleState
>;

/**
 * The state a create or update may name.
 *
 * Derived from the machine's edges rather than restated: `draft` and
 * `published` both have an inbound edge, `archived` is entered by `archive`
 * and so is writable too. `machine.test.ts` pins this list to the states with
 * an inbound edge.
 */
export const HELP_CENTER_ARTICLE_WRITE_STATES = [
  "draft",
  "published",
  "archived",
] as const;

export const HelpCenterArticleWriteState = S.Literals(
  HELP_CENTER_ARTICLE_WRITE_STATES
);

export type THelpCenterArticleWriteState = S.Schema.Type<
  typeof HelpCenterArticleWriteState
>;

/**
 * Where an article's body came from.
 *
 * Plain text rather than a Postgres enum for the reason `post.source` is: a
 * new provenance should not be a migration. It exists before any importer does
 * so that a sync write is distinguishable from a human edit at the row level,
 * which is what a conflict policy needs and what a column added later cannot
 * answer for rows written before it existed.
 */
export const HelpCenterArticleSource = S.Literals([
  "EDITOR",
  "API",
  "GITHUB",
  "IMPORT",
]);

export type THelpCenterArticleSource = S.Schema.Type<
  typeof HelpCenterArticleSource
>;
