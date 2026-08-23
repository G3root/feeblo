import * as S from "effect/Schema";

/**
 * Canonical contact/company source vocabulary.
 *
 * The `contact.source` and `company.source` columns are plain text (not a
 * Postgres enum) so new sources don't require migrations; this Effect Schema
 * is the single source of truth.
 */
export const EntitySource = S.Literals([
  "DASHBOARD",
  "WIDGET",
  "API",
  "IMPORT",
]);

export type TEntitySource = S.Schema.Type<typeof EntitySource>;
