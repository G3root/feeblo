import { currentDb, schema } from "@feeblo/db";
import { UserId } from "@feeblo/id";
import { and, eq, sql, type SQLWrapper } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { isShadowUserEmail } from "../identity/emails";
import { UserPersistenceError } from "./errors";

/**
 * SHA-256 of a normalised address, hex encoded. Shared with identity linking
 * so a shadow can be found from the address its owner just proved even when no
 * contact row links them any more.
 */
export const hashEmail = (email: string) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    return Buffer.from(
      yield* crypto.digest(
        "SHA-256",
        new TextEncoder().encode(email.toLowerCase().trim())
      )
    ).toString("hex");
  }).pipe(Effect.orDie);

const generateRandomEmail = (prefix: string) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const suffix = Buffer.from(yield* crypto.randomBytes(8)).toString("hex");
    return `${prefix}-${suffix}@feeblo.com`;
  }).pipe(Effect.orDie);

interface UpsertSsoUserInput {
  email: string;
  name: string;
  /**
   * The SSO user is always scoped to a single organization (widget portal
   * user). The value is required: an SSO token never returns an existing
   * globally-registered account, so it cannot be used to take over a real
   * user's session, and an SSO user created for one organization is never
   * re-scoped to another.
   */
  restrictedToOrganizationId: string;
}

interface ProvisionShadowUserInput {
  /**
   * The subject's real email. It is only hashed for matching; the stored
   * account email is always synthetic, so a shadow user can never collide
   * with — or be claimed by — a globally-registered account.
   */
  email: string;
  name: string;
  restrictedToOrganizationId: string;
}

const makeUserRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    getById: (id: string) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(schema.userTable)
          .where(eq(schema.userTable.id, id))
          .limit(1);
        return rows[0] ? Option.some(rows[0]) : Option.none();
      }),

    /**
     * Finds a user by verified identity hash that a workspace may attribute
     * content to: globally-registered accounts, or accounts restricted to
     * exactly this organization. Users restricted to other organizations are
     * deliberately invisible so one workspace cannot adopt another
     * workspace's portal identities.
     *
     * Precedence: when both a global account and an organization-scoped
     * (shadow/SSO portal) account share the same email, a verified
     * organization-scoped row wins. It is the workspace's own view of that
     * human and matches the session identity returned by `upsertSsoUser`
     * (which never returns a global account), so on-behalf attribution and
     * the organization-access notification gate (`evaluateOrganizationAccess`,
     * `sso` class) consistently use the same user ID instead of splitting
     * history across two IDs. An unverified organization-scoped row (an
     * attribution-only shadow) never outranks a real global account.
     *
     * Matching is by email hash, plus the address itself for a global account:
     * a better-auth-created row carries no `email_hash`, so the address is the
     * only identity it has. Org-scoped rows match by hash alone, so a
     * synthetic inbox typed as a subject can never adopt one.
     */
    findAdoptableByIdentityHash: (args: {
      email: string;
      organizationId: string;
    }) =>
      Effect.gen(function* () {
        const emailHash = yield* hashEmail(args.email);
        const normalisedEmail = args.email.toLowerCase().trim();
        const rows = yield* db
          .select()
          .from(schema.userTable)
          .where(
            and(
              sql`(
                (
                  ${schema.userTable.restrictedToOrganizationId} IS NULL
                  AND lower(${schema.userTable.email}) = ${normalisedEmail}
                )
                OR ${schema.userTable.emailHash} = ${emailHash}
              )`,
              sql`(${schema.userTable.restrictedToOrganizationId} IS NULL OR ${schema.userTable.restrictedToOrganizationId} = ${args.organizationId})`
            )
          )
          // Precedence: a verified portal identity bound to this workspace,
          // then a real unrestricted account, then an attribution-only shadow.
          // A shadow must never outrank a verified account: deleting a contact
          // leaves its shadow behind while attributed content still refers to
          // it, and adopting that orphan would strand the human's real
          // identity on content history they can never sign in to.
          .orderBy(
            sql`CASE
              WHEN ${schema.userTable.restrictedToOrganizationId} IS NULL THEN 1
              WHEN ${schema.userTable.emailVerified} IS TRUE THEN 0
              ELSE 2
            END`,
            schema.userTable.id
          )
          .limit(1);
        return rows[0] ? Option.some(rows[0]) : Option.none();
      }),

    upsertSsoUser: (args: UpsertSsoUserInput) =>
      Effect.gen(function* () {
        const emailHash = yield* hashEmail(args.email);

        // Explicit type guard: an SSO portal upsert must always be scoped to an
        // organization. Guard before the lookup so the query below can never
        // fall back to matching a globally-registered Better Auth user that
        // merely carries an email hash from an earlier SSO login.
        const restrictedToOrganizationId = args.restrictedToOrganizationId;
        if (restrictedToOrganizationId == null) {
          return yield* new UserPersistenceError({
            message: "SSO portal upsert requires a restrictedToOrganizationId",
          });
        }

        // Match an existing SSO-only user by its email hash and organization.
        const existingByHash = yield* db
          .select()
          .from(schema.userTable)
          .where(
            and(
              eq(schema.userTable.emailHash, emailHash),
              eq(
                schema.userTable.restrictedToOrganizationId,
                restrictedToOrganizationId
              )
            )
          )
          .limit(1)
          .pipe(Effect.map((rows) => rows[0]));

        if (existingByHash) {
          const updatedAt = yield* DateTime.nowAsDate;
          // A `behalf-*` match means an on-behalf shadow user was provisioned
          // for this human before they ever used the widget portal. The SSO
          // sign-in heals the identity in place: the row keeps every attributed
          // contact/post/vote/comment/subscription (nothing to reassign — it
          // already is the session identity) but is promoted to a clean,
          // verified portal account with a fresh synthetic `sso-` inbox.
          const promotedFromShadow = isShadowUserEmail(existingByHash.email);
          const [updated = null] = yield* db
            .update(schema.userTable)
            .set({
              name: args.name,
              ...(promotedFromShadow && {
                email: yield* generateRandomEmail("sso"),
                emailVerified: true,
              }),
              restrictedToOrganizationId,
              jwtAutoLoginAt: updatedAt,
              updatedAt,
            })
            .where(eq(schema.userTable.id, existingByHash.id))
            .returning();
          if (!updated) {
            return yield* new UserPersistenceError({
              message: "SSO user update did not return a row",
            });
          }
          return updated;
        }

        // Create a new SSO-only user with a random email address. The
        // (emailHash, restrictedToOrganizationId) unique index closes the
        // select-then-insert race: a targeted ON CONFLICT turns a lost race
        // into an empty returning set instead of a duplicate row, and the
        // winner is re-read and updated through the same promotion path as
        // an existing row.
        const id = yield* UserId.generate;
        const now = yield* DateTime.nowAsDate;
        const [created = null] = yield* db
          .insert(schema.userTable)
          .values({
            id,
            name: args.name,
            email: yield* generateRandomEmail("sso"),
            emailVerified: true,
            emailHash,
            jwtAutoLoginAt: now,
            restrictedToOrganizationId,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({
            target: [
              schema.userTable.emailHash,
              schema.userTable.restrictedToOrganizationId,
            ],
          })
          .returning();
        if (created) {
          return created;
        }
        const [winner] = yield* db
          .select()
          .from(schema.userTable)
          .where(
            and(
              eq(schema.userTable.emailHash, emailHash),
              eq(
                schema.userTable.restrictedToOrganizationId,
                restrictedToOrganizationId
              )
            )
          )
          .limit(1);
        if (!winner) {
          return yield* new UserPersistenceError({
            message: "SSO user insert did not return a row",
          });
        }
        const winnerUpdatedAt = yield* DateTime.nowAsDate;
        const promotedFromShadow = isShadowUserEmail(winner.email);
        const [winnerUpdated = null] = yield* db
          .update(schema.userTable)
          .set({
            name: args.name,
            ...(promotedFromShadow && {
              email: yield* generateRandomEmail("sso"),
              emailVerified: true,
            }),
            restrictedToOrganizationId,
            jwtAutoLoginAt: winnerUpdatedAt,
            updatedAt: winnerUpdatedAt,
          })
          .where(eq(schema.userTable.id, winner.id))
          .returning();
        if (!winnerUpdated) {
          return yield* new UserPersistenceError({
            message: "SSO user update did not return a row",
          });
        }
        return winnerUpdated;
      }),

    /**
     * Finds or creates the attribution-only user backing an on-behalf
     * subject (see plan-on-behalf.md). Shadow users carry a synthetic
     * `behalf-*` email, are never email-verified, and have no credentials,
     * so they can never authenticate. Matching is scoped to one organization
     * by (email hash, organization) and may adopt an existing SSO portal
     * user for the same human — their identity is already proven by the
     * customer's identity provider, so their verification state is left
     * untouched.
     */
    provisionShadowUser: (args: ProvisionShadowUserInput) =>
      Effect.gen(function* () {
        const emailHash = yield* hashEmail(args.email);
        const restrictedToOrganizationId = args.restrictedToOrganizationId;

        if (restrictedToOrganizationId == null) {
          return yield* new UserPersistenceError({
            message: "Shadow user provisioning requires a organization scope",
          });
        }

        // Match any org-restricted user for this human in this organization:
        // a previously provisioned shadow user or an SSO portal user.
        const existingByHash = yield* db
          .select({ id: schema.userTable.id })
          .from(schema.userTable)
          .where(
            and(
              eq(schema.userTable.emailHash, emailHash),
              eq(
                schema.userTable.restrictedToOrganizationId,
                restrictedToOrganizationId
              )
            )
          )
          .limit(1)
          .pipe(Effect.map((rows) => rows[0]));

        if (existingByHash) {
          const updatedAt = yield* DateTime.nowAsDate;
          const [updated = null] = yield* db
            .update(schema.userTable)
            .set({ name: args.name, updatedAt })
            .where(eq(schema.userTable.id, existingByHash.id))
            .returning();
          if (!updated) {
            return yield* new UserPersistenceError({
              message: "Shadow user update did not return a row",
            });
          }
          return updated;
        }

        // Create a new shadow user with a random, never-mailable address.
        // Same targeted ON CONFLICT race handling as upsertSsoUser: a lost
        // race re-reads the winner and applies the standard name update.
        const id = yield* UserId.generate;
        const now = yield* DateTime.nowAsDate;
        const [created = null] = yield* db
          .insert(schema.userTable)
          .values({
            id,
            name: args.name,
            email: yield* generateRandomEmail("behalf"),
            emailVerified: false,
            emailHash,
            restrictedToOrganizationId,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({
            target: [
              schema.userTable.emailHash,
              schema.userTable.restrictedToOrganizationId,
            ],
          })
          .returning();
        if (created) {
          return created;
        }
        const [winner] = yield* db
          .select()
          .from(schema.userTable)
          .where(
            and(
              eq(schema.userTable.emailHash, emailHash),
              eq(
                schema.userTable.restrictedToOrganizationId,
                restrictedToOrganizationId
              )
            )
          )
          .limit(1);
        if (!winner) {
          return yield* new UserPersistenceError({
            message: "Shadow user insert did not return a row",
          });
        }
        const winnerUpdatedAt = yield* DateTime.nowAsDate;
        const [winnerUpdated = null] = yield* db
          .update(schema.userTable)
          .set({ name: args.name, updatedAt: winnerUpdatedAt })
          .where(eq(schema.userTable.id, winner.id))
          .returning();
        if (!winnerUpdated) {
          return yield* new UserPersistenceError({
            message: "Shadow user update did not return a row",
          });
        }
        return winnerUpdated;
      }),

    /**
     * Deletes a `behalf-*` shadow account that nothing refers to any more.
     *
     * Deleting a contact leaves its shadow behind, because the votes and
     * comments rendered under it must survive and a later attribution of the
     * same email adopts it again. When no contact, post, vote, comment,
     * subscription, email link, or notification refers to the account, the
     * row is unreachable: nothing renders it and no later write needs it, so
     * it goes with the contact.
     *
     * Locks the account for update before counting. A concurrent write that
     * references the account either lands before the count (the shadow stays)
     * or waits on the lock and fails its own foreign key if the shadow is
     * deleted, which is louder than a cascade silently removing the write.
     *
     * Runs on the caller's transaction through the fiber-local connection.
     * Returns whether the account was deleted.
     */
    deleteShadowUserIfUnreferenced: (userId: string) =>
      Effect.gen(function* () {
        const [user] = yield* db
          .select({ email: schema.userTable.email })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, userId))
          .limit(1)
          .for("update");
        if (!user || !isShadowUserEmail(user.email)) {
          return false;
        }

        // Every durable row that can name this account, each probed with an
        // EXISTS over its foreign-key index so the whole check is one round
        // trip. Two groups are deliberately absent:
        //
        // - Credential rows (`session`, `account`, `two_factor`) cascade by
        //   design. A shadow can never hold one, and removing a broken
        //   credential is the cleanup's job rather than data loss.
        // - References that are `ON DELETE SET NULL` (`api_key`, `board`,
        //   `tag`, `changelog`, `post_activity.actor_id`,
        //   `notification.actor_user_id`) keep their row and only lose a
        //   pointer. A shadow is ever only a subject, never a creator or an
        //   actor, so those pointers cannot name it.
        //
        // `contact` and `email_contact` are set-null too; they are listed
        // because their pointers are the attribution link a later write
        // adopts again.
        // One `EXISTS` over a table's foreign-key index, asking whether any
        // row names this account. `column` is the account reference on that
        // table, e.g. `asset.userId`.
        const namesAccount = (table: PgTable, column: SQLWrapper) =>
          sql<boolean>`EXISTS (SELECT 1 FROM ${table} WHERE ${column} = ${userId})`;
        const [references = null] = yield* db
          .select({
            asset: namesAccount(schema.assetTable, schema.assetTable.userId),
            changelogSubscription: namesAccount(
              schema.changelogSubscriptionTable,
              schema.changelogSubscriptionTable.userId
            ),
            comment: namesAccount(
              schema.commentTable,
              schema.commentTable.userId
            ),
            commentReaction: namesAccount(
              schema.commentReactionTable,
              schema.commentReactionTable.userId
            ),
            contact: namesAccount(
              schema.contactTable,
              schema.contactTable.userId
            ),
            emailContact: namesAccount(
              schema.emailContactTable,
              schema.emailContactTable.userId
            ),
            invitation: namesAccount(
              schema.invitationTable,
              schema.invitationTable.inviterId
            ),
            member: namesAccount(schema.memberTable, schema.memberTable.userId),
            notification: namesAccount(
              schema.notificationTable,
              schema.notificationTable.recipientUserId
            ),
            notificationPreference: namesAccount(
              schema.notificationPreferenceTable,
              schema.notificationPreferenceTable.userId
            ),
            post: namesAccount(schema.postTable, schema.postTable.creatorId),
            postReaction: namesAccount(
              schema.postReactionTable,
              schema.postReactionTable.userId
            ),
            postSubscription: namesAccount(
              schema.postSubscriptionTable,
              schema.postSubscriptionTable.userId
            ),
            upvote: namesAccount(schema.upvoteTable, schema.upvoteTable.userId),
          })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, userId))
          .limit(1);

        if (references === null || Object.values(references).some(Boolean)) {
          return false;
        }

        yield* db
          .delete(schema.userTable)
          .where(eq(schema.userTable.id, userId));
        return true;
      }),
  };
});

export class UserRepository extends Context.Service<UserRepository>()(
  "UserRepository",
  {
    make: makeUserRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
