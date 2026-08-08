import * as S from "effect/Schema";

/**
 * Canonical transactional-email event-kind vocabulary.
 *
 * The `email_event.kind` column is plain text (not a Postgres enum) so new
 * event kinds don't require migrations; this Effect Schema is the single
 * source of truth. The column type is derived from it in `schema/email.ts`.
 */
export const EmailEventKind = S.Literals(["post_status_changed"]);

export type TEmailEventKind = S.Schema.Type<typeof EmailEventKind>;
