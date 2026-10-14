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

/**
 * Contact sources add the attribution path.
 *
 * A contact created as a side effect of an on-behalf post, vote, or comment is
 * not a dashboard create, and the Customers table says so. Companies have no
 * attribution path, so `EntitySource` stays the vocabulary that both columns
 * share and that the Public API company DTO mirrors; widening this union never
 * widens a published payload (see ADR 0004).
 */
export const ContactSource = S.Union([EntitySource, S.Literals(["ON_BEHALF"])]);

export type TContactSource = S.Schema.Type<typeof ContactSource>;
