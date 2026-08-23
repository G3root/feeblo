import * as S from "effect/Schema";

/**
 * Canonical post-source vocabulary.
 *
 * The `post.source` column is plain text (not a Postgres enum) so new sources
 * don't require migrations; this Effect Schema is the single source of truth.
 */
export const PostSource = S.Literals([
  "DASHBOARD",
  "WIDGET",
  "API",
  "IMPORT",
  "PUBLIC_BOARD",
  "SLACK",
  "DISCORD",
]);

export type TPostSource = S.Schema.Type<typeof PostSource>;
