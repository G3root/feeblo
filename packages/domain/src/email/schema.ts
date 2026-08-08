import { EmailEventKind } from "@feeblo/db/validation-schema/email-event-kind";
import { EmailEventStatus as EmailEventStatusSchema } from "@feeblo/db/validation-schema/email-event-status";
import { WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

export const EmailSuppressed = S.Struct({
  email: S.String,
  reason: S.Literals(["hard_bounce", "complaint", "manual"]),
  createdAt: S.DateFromString,
});

export type TEmailSuppressed = S.Schema.Type<typeof EmailSuppressed>;

export const EmailSuppressedList = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type TEmailSuppressedList = S.Schema.Type<typeof EmailSuppressedList>;

export const EmailSuppressedDelete = S.Struct({
  email: S.String,
  organizationId: WorkspaceId.schema,
});

export type TEmailSuppressedDelete = S.Schema.Type<
  typeof EmailSuppressedDelete
>;

export const EmailDeadLetter = S.Struct({
  id: S.String,
  kind: EmailEventKind,
  attempts: S.Number,
  lastError: S.NullOr(S.String),
  availableAt: S.DateFromString,
  createdAt: S.DateFromString,
});

export type TEmailDeadLetter = S.Schema.Type<typeof EmailDeadLetter>;

export const EmailDeadLetterList = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type TEmailDeadLetterList = S.Schema.Type<typeof EmailDeadLetterList>;

/** Per-status and per-template delivery counts for observability. */
export const EmailDeliveryStats = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type TEmailDeliveryStats = S.Schema.Type<typeof EmailDeliveryStats>;

export const EmailDeliveryStatsResult = S.Struct({
  byStatus: S.Record(
    S.Literals(["sent", "failed", "skipped", "suppressed"]),
    S.Number
  ),
  byTemplate: S.Record(S.String, S.Number),
});

export type TEmailDeliveryStatsResult = S.Schema.Type<
  typeof EmailDeliveryStatsResult
>;

/**
 * Triage row: one email event with the originating post and a per-status
 * delivery summary — "did this member get the email about post X?".
 */
export const EmailEvent = S.Struct({
  id: S.String,
  kind: EmailEventKind,
  status: EmailEventStatusSchema,
  attempts: S.Number,
  lastError: S.NullOr(S.String),
  createdAt: S.DateFromString,
  postId: S.NullOr(S.String),
  postTitle: S.NullOr(S.String),
  deliveries: S.Record(S.String, S.Number),
});

export type TEmailEvent = S.Schema.Type<typeof EmailEvent>;

export const EmailEventList = S.Struct({
  organizationId: WorkspaceId.schema,
  limit: S.optional(S.Number),
});

export type TEmailEventList = S.Schema.Type<typeof EmailEventList>;
