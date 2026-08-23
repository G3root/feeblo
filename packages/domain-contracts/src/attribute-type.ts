import * as S from "effect/Schema";

/**
 * Canonical custom-attribute data-type vocabulary.
 *
 * The `*_attribute_definition.type` columns are plain text (not a Postgres
 * enum) so new data types don't require migrations; this Effect Schema is the
 * single source of truth.
 */
export const AttributeType = S.Literals([
  "TEXT",
  "INTEGER",
  "DECIMAL",
  "BOOLEAN",
  "DATE",
]);

export type TAttributeType = S.Schema.Type<typeof AttributeType>;
