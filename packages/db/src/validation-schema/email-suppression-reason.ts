import * as S from "effect/Schema";

/**
 * Canonical suppression reason vocabulary.
 *
 * The `suppressed_email.reason` column is plain text (not a Postgres enum) so
 * new reasons don't require migrations; this Effect Schema is the single
 * source of truth. The column type is derived from it in `schema/email.ts`.
 */
export const EmailSuppressionReason = S.Literals([
  "hard_bounce",
  "complaint",
  "manual",
]);

export type TEmailSuppressionReason = S.Schema.Type<
  typeof EmailSuppressionReason
>;
