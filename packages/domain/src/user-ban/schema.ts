import {
  EmailAddress,
  normalizeEmailAddress,
} from "@feeblo/db/validation-schema/email";
import {
  CommentId,
  ContactId,
  PostId,
  UserBanId,
  UserId,
  WorkspaceId,
} from "@feeblo/id";
import * as Schema from "effect/Schema";

const PersistedDate = Schema.Union([Schema.Date, Schema.DateFromString]);

/**
 * The subject an operator can name when banning someone.
 *
 * A `contact` is the CRM-facing way to name a customer; the repository
 * resolves it to the account and address that the ban actually stores. An
 * `email` target is how a person is banned before they have an account, and a
 * `user` target is how a portal account with no contact row is banned.
 *
 * A `comment` or `post` target exists for the moderation menus: the client
 * already has the row, so it names that row instead of the account and the
 * server resolves the author from something it can prove belongs to this
 * workspace. That keeps an arbitrary account id from being usable to read
 * another tenant's user name or address, and it makes participation itself the
 * proof of relationship — somebody who posted here is bannable here even when
 * they have no contact row and no restricted account.
 */
export const UserBanTarget = Schema.Union([
  Schema.TaggedStruct("user", { userId: UserId.schema }),
  Schema.TaggedStruct("contact", { contactId: ContactId.schema }),
  Schema.TaggedStruct("email", { email: EmailAddress }),
  Schema.TaggedStruct("comment", { commentId: CommentId.schema }),
  Schema.TaggedStruct("post", { postId: PostId.schema }),
]);

export type UserBanTarget = Schema.Schema.Type<typeof UserBanTarget>;

/** The dashboard projection, with the display fields the list joins in. */
export const UserBanSummary = Schema.Struct({
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

export type UserBanSummary = Schema.Schema.Type<typeof UserBanSummary>;

export const UserBanListRequest = Schema.Struct({
  limit: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ maximum: 100, minimum: 1 }))
  ),
  offset: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  organizationId: WorkspaceId.schema,
  search: Schema.optional(
    Schema.String.pipe(Schema.check(Schema.isMaxLength(320)))
  ),
});

export type UserBanListRequest = Schema.Schema.Type<typeof UserBanListRequest>;

export const UserBanListResult = Schema.Struct({
  items: Schema.Array(UserBanSummary),
  total: Schema.Int,
});

export type UserBanListResult = Schema.Schema.Type<typeof UserBanListResult>;

export const UserBanCreate = Schema.Struct({
  organizationId: WorkspaceId.schema,
  target: UserBanTarget,
  /**
   * Also delete the person's posts and comments in this workspace.
   *
   * Off by default: a ban is forward-looking, and an operator who wants the
   * history gone says so explicitly. The dashboard's comment menu offers it
   * as a checkbox on the ban confirmation.
   */
  deleteContent: Schema.optional(Schema.Boolean),
  /** Internal operator context; never shown to the banned end user. */
  reason: Schema.optional(
    Schema.String.pipe(
      Schema.check(Schema.isMinLength(1)),
      Schema.check(Schema.isMaxLength(500))
    )
  ),
});

export type UserBanCreate = Schema.Schema.Type<typeof UserBanCreate>;

/** What a ban did, so the confirmation can name the deleted content. */
export const UserBanResult = Schema.Struct({
  ban: UserBanSummary,
  deletedComments: Schema.Int,
  deletedPosts: Schema.Int,
});

export type UserBanResult = Schema.Schema.Type<typeof UserBanResult>;

/**
 * Which ban to lift.
 *
 * The settings list names the row it shows. A moderation menu has no ban id to
 * send: it has the post or comment the ban was made from, so it names the
 * author the same way `BanUser` does and the server resolves the row. The
 * second form is what makes unbanning work for an address-only ban, which has
 * no account id for the client to match either.
 */
export const UserBanRemove = Schema.Union([
  Schema.TaggedStruct("row", {
    id: UserBanId.schema,
    organizationId: WorkspaceId.schema,
  }),
  Schema.TaggedStruct("author", {
    organizationId: WorkspaceId.schema,
    target: UserBanTarget,
  }),
]);

export type UserBanRemove = Schema.Schema.Type<typeof UserBanRemove>;

export const UserBanStatusRequest = Schema.Struct({
  organizationId: WorkspaceId.schema,
});

export type UserBanStatusRequest = Schema.Schema.Type<
  typeof UserBanStatusRequest
>;

/** The portal's own status; the reason is never part of this projection. */
export const UserBanStatus = Schema.Struct({
  banned: Schema.Boolean,
});

export type UserBanStatus = Schema.Schema.Type<typeof UserBanStatus>;

/** Normalizes an operator-supplied address before it reaches a lookup. */
export const normalizeBanEmail = (input: string): string =>
  normalizeEmailAddress(input);

/** The failure a public write answers when the caller is banned. */
export const PARTICIPATION_BANNED_REASON =
  "You are banned from participating in this workspace.";
