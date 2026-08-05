import * as S from "effect/Schema";

/**
 * Canonical tag-type vocabulary.
 *
 * The `tag.type` column is plain text (not a Postgres enum) so new tag types
 * don't require migrations; this Effect Schema is the single source of truth.
 */
export const TagType = S.Literals(["FEEDBACK", "CHANGELOG"]);

export type TTagType = S.Schema.Type<typeof TagType>;
