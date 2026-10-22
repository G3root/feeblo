import {
  EmailAddress,
  EmailSuppressionReason,
  normalizeEmailAddress,
} from "@feeblo/db/validation-schema/email";
import { WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const PersistedDate = Schema.Union([Schema.Date, Schema.DateFromString]);

/**
 * A suppression row as the dashboard reads it.
 *
 * `organizationId` is absent rather than nullable: the listing is always scoped
 * to the caller's workspace, and a platform row (mail that belongs to no
 * workspace) is never returned by a tenant surface.
 */
export const EmailSuppressionRecord = Schema.Struct({
  createdAt: PersistedDate,
  email: EmailAddress,
  firstReason: EmailSuppressionReason,
  note: Schema.NullOr(
    Schema.String.pipe(Schema.check(Schema.isMaxLength(500)))
  ),
  organizationId: WorkspaceId.schema,
  providerEventId: Schema.NullOr(
    Schema.String.pipe(Schema.check(Schema.isMaxLength(256)))
  ),
  reason: EmailSuppressionReason,
  updatedAt: PersistedDate,
});

export type EmailSuppressionRecord = Schema.Schema.Type<
  typeof EmailSuppressionRecord
>;

/** The dashboard projection; it never carries a provider event identifier. */
export const EmailSuppressionSummary = Schema.Struct({
  createdAt: PersistedDate,
  email: EmailAddress,
  firstReason: EmailSuppressionReason,
  note: Schema.NullOr(
    Schema.String.pipe(Schema.check(Schema.isMaxLength(500)))
  ),
  reason: EmailSuppressionReason,
  updatedAt: PersistedDate,
});

export type EmailSuppressionSummary = Schema.Schema.Type<
  typeof EmailSuppressionSummary
>;

export const EmailSuppressionListRequest = Schema.Struct({
  limit: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ maximum: 100, minimum: 1 }))
  ),
  offset: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  organizationId: WorkspaceId.schema,
  reason: Schema.optionalKey(EmailSuppressionReason),
  search: Schema.optionalKey(
    Schema.String.pipe(Schema.check(Schema.isMaxLength(320)))
  ),
});

export type EmailSuppressionListRequest = Schema.Schema.Type<
  typeof EmailSuppressionListRequest
>;

export const EmailSuppressionListResult = Schema.Struct({
  items: Schema.Array(EmailSuppressionSummary),
  total: Schema.Int,
});

export type EmailSuppressionListResult = Schema.Schema.Type<
  typeof EmailSuppressionListResult
>;

/**
 * Adds a manual block. The reason is not a parameter: only
 * `administrative_block` can be written by a human, so a caller cannot claim a
 * provider event it did not receive.
 */
export const EmailSuppressionAddRequest = Schema.Struct({
  email: EmailAddress,
  note: Schema.optionalKey(
    Schema.String.pipe(
      Schema.check(Schema.isMinLength(1)),
      Schema.check(Schema.isMaxLength(500))
    )
  ),
  organizationId: WorkspaceId.schema,
});

export type EmailSuppressionAddRequest = Schema.Schema.Type<
  typeof EmailSuppressionAddRequest
>;

export const EmailSuppressionRemoveRequest = Schema.Struct({
  email: EmailAddress,
  organizationId: WorkspaceId.schema,
});

export type EmailSuppressionRemoveRequest = Schema.Schema.Type<
  typeof EmailSuppressionRemoveRequest
>;

export const EmailSuppressionStatsRequest = Schema.Struct({
  organizationId: WorkspaceId.schema,
});

export type EmailSuppressionStatsRequest = Schema.Schema.Type<
  typeof EmailSuppressionStatsRequest
>;

export const EmailSuppressionStats = Schema.Struct({
  administrativeBlock: Schema.Int,
  complaint: Schema.Int,
  hardBounce: Schema.Int,
  total: Schema.Int,
});

export type EmailSuppressionStats = Schema.Schema.Type<
  typeof EmailSuppressionStats
>;

export class EmailSuppressionInputError extends Schema.TaggedError<EmailSuppressionInputError>()(
  "EmailSuppressionInputError",
  {
    operation: Schema.String,
    reason: Schema.String,
  }
) {}

export class EmailSuppressionDataError extends Schema.TaggedError<EmailSuppressionDataError>()(
  "EmailSuppressionDataError",
  {
    cause: Schema.optionalKey(Schema.Defect()),
    operation: Schema.String,
    reason: Schema.String,
  }
) {}

/** Normalizes an operator-supplied address before it reaches a lookup. */
export const parseSuppressionEmail = (
  input: string,
  operation: string
): Effect.Effect<EmailAddress, EmailSuppressionInputError> =>
  Schema.decodeEffect(EmailAddress)(normalizeEmailAddress(input)).pipe(
    Effect.mapError(
      () =>
        new EmailSuppressionInputError({
          operation,
          reason: "Email address is invalid",
        })
    )
  );
