import {
  EmailAddress,
  normalizeEmailAddress,
} from "@feeblo/db/validation-schema/email";
import { ContactId, UserBlockId, UserId, WorkspaceId } from "@feeblo/id";
import * as Schema from "effect/Schema";

const PersistedDate = Schema.Union([Schema.Date, Schema.DateFromString]);

/**
 * The subject an operator can name when blocking someone.
 *
 * A `contact` is the CRM-facing way to name a customer; the repository
 * resolves it to the account and address that the block actually stores. An
 * `email` target is how a person is blocked before they have an account, and a
 * `user` target is how a portal account with no contact row is blocked.
 */
export const UserBlockTarget = Schema.Union([
  Schema.TaggedStruct("user", { userId: UserId.schema }),
  Schema.TaggedStruct("contact", { contactId: ContactId.schema }),
  Schema.TaggedStruct("email", { email: EmailAddress }),
]);

export type UserBlockTarget = Schema.Schema.Type<typeof UserBlockTarget>;

/** The dashboard projection, with the display fields the list joins in. */
export const UserBlockSummary = Schema.Struct({
  id: Schema.String,
  userId: Schema.NullOr(Schema.String),
  email: Schema.NullOr(EmailAddress),
  userName: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(
    Schema.String.pipe(Schema.check(Schema.isMaxLength(500)))
  ),
  createdAt: PersistedDate,
  createdByName: Schema.NullOr(Schema.String),
});

export type UserBlockSummary = Schema.Schema.Type<typeof UserBlockSummary>;

export const UserBlockListRequest = Schema.Struct({
  limit: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ maximum: 100, minimum: 1 }))
  ),
  offset: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  organizationId: WorkspaceId.schema,
  search: Schema.optional(
    Schema.String.pipe(Schema.check(Schema.isMaxLength(320)))
  ),
});

export type UserBlockListRequest = Schema.Schema.Type<
  typeof UserBlockListRequest
>;

export const UserBlockListResult = Schema.Struct({
  items: Schema.Array(UserBlockSummary),
  total: Schema.Int,
});

export type UserBlockListResult = Schema.Schema.Type<
  typeof UserBlockListResult
>;

export const UserBlockCreate = Schema.Struct({
  organizationId: WorkspaceId.schema,
  target: UserBlockTarget,
  /** Internal operator context; never shown to the blocked end user. */
  reason: Schema.optional(
    Schema.String.pipe(
      Schema.check(Schema.isMinLength(1)),
      Schema.check(Schema.isMaxLength(500))
    )
  ),
});

export type UserBlockCreate = Schema.Schema.Type<typeof UserBlockCreate>;

export const UserBlockRemove = Schema.Struct({
  id: UserBlockId.schema,
  organizationId: WorkspaceId.schema,
});

export type UserBlockRemove = Schema.Schema.Type<typeof UserBlockRemove>;

export const UserBlockStatusRequest = Schema.Struct({
  organizationId: WorkspaceId.schema,
});

export type UserBlockStatusRequest = Schema.Schema.Type<
  typeof UserBlockStatusRequest
>;

/** The portal's own status; the reason is never part of this projection. */
export const UserBlockStatus = Schema.Struct({
  blocked: Schema.Boolean,
});

export type UserBlockStatus = Schema.Schema.Type<typeof UserBlockStatus>;

/** Normalizes an operator-supplied address before it reaches a lookup. */
export const normalizeBlockEmail = (input: string): string =>
  normalizeEmailAddress(input);

/** The failure a public write answers when the caller is blocked. */
export const PARTICIPATION_BLOCKED_REASON =
  "You cannot participate in this workspace.";
