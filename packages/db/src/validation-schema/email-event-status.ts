import * as S from "effect/Schema";

/**
 * Canonical transactional-email event status vocabulary.
 *
 * The `email_event.status` column is plain text (not a Postgres enum) so new
 * states don't require migrations; this Effect Schema is the single source of
 * truth. The column type is derived from it in `schema/email.ts`.
 */
export const EmailEventStatus = S.Literals([
  "pending",
  "processing",
  "sent",
  "failed",
]);

export type TEmailEventStatus = S.Schema.Type<typeof EmailEventStatus>;
