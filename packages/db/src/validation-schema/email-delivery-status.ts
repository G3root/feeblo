import * as S from "effect/Schema";

/**
 * Canonical per-recipient delivery status vocabulary.
 *
 * The `email_delivery.status` column is plain text (not a Postgres enum) so
 * new states don't require migrations; this Effect Schema is the single
 * source of truth. The column type is derived from it in `schema/email.ts`.
 */
export const EmailDeliveryStatus = S.Literals([
  "sent",
  "skipped",
  "failed",
  "suppressed",
]);

export type TEmailDeliveryStatus = S.Schema.Type<typeof EmailDeliveryStatus>;
