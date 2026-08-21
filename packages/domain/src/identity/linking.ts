import { currentDb, schema, transaction } from "@feeblo/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { SubjectNotFoundError } from "./errors";
import { isShadowUserEmail, isSyntheticEmail } from "./emails";

/** Row counts produced by one shadow-user healing. */
export interface HealedIdentityCounts {
  contacts: number;
  posts: number;
  upvotesMoved: number;
  /** Shadow votes dropped because the real user had already voted. */
  upvotesDropped: number;
  comments: number;
  postSubscriptionsMoved: number;
  /** Shadow subscriptions dropped as duplicates of the real user's rows. */
  postSubscriptionsDropped: number;
  /** Deferred email subscriptions activated by the surviving account's access. */
  subscriptionsActivated: number;
}

export interface ShadowHealSummary {
  /** Organization ids whose contacts were healed off a shadow user. */
  organizationIds: ReadonlyArray<string>;
  totals: HealedIdentityCounts;
}

const emptyCounts = (): HealedIdentityCounts => ({
  contacts: 0,
  posts: 0,
  upvotesMoved: 0,
  upvotesDropped: 0,
  comments: 0,
  postSubscriptionsMoved: 0,
  postSubscriptionsDropped: 0,
  subscriptionsActivated: 0,
});

const addCounts = (a: HealedIdentityCounts, b: HealedIdentityCounts) => ({
  contacts: a.contacts + b.contacts,
  posts: a.posts + b.posts,
  upvotesMoved: a.upvotesMoved + b.upvotesMoved,
  upvotesDropped: a.upvotesDropped + b.upvotesDropped,
  comments: a.comments + b.comments,
  postSubscriptionsMoved: a.postSubscriptionsMoved + b.postSubscriptionsMoved,
  postSubscriptionsDropped:
    a.postSubscriptionsDropped + b.postSubscriptionsDropped,
  subscriptionsActivated:
    a.subscriptionsActivated + b.subscriptionsActivated,
});

/**
 * Moves every row attributed to `shadowUserId` onto `realUserId` inside one
 * transaction, then optionally deletes the shadow user row. Order matters:
 *
 * 1. `contact.user_id` — reassignment must precede the shadow deletion so
 *    contact ownership survives its `ON DELETE SET NULL` cascade.
 * 2. `post.creator_id`.
 * 3. `upvote.user_id` — the `(user_id, post_id)` unique index rejects a naive
 *    update when the real user already voted on the same post, so colliding
 *    shadow votes are deleted first (the real user's vote is the surviving
 *    expression of intent).
 * 4. `comment.user_id`.
 * 5. `post_subscription.user_id` — same collision rule via its
 *    `(post_id, user_id)` unique index.
 * 6. `email_contact.user_id` moves unconditionally; `deferred_no_access`
 *    email subscriptions for each healed contact activate only when the
 *    surviving account satisfies notification eligibility (verified email
 *    AND member ∨ SSO-bound-to-org ∨ unrestricted global).
 * 7. The shadow user row is deleted last, so every cascade sees healed data.
 */
export const linkShadowUser = ({
  shadowUserId,
  realUserId,
  deleteShadowUser,
}: {
  shadowUserId: string;
  realUserId: string;
  /**
   * The better-auth plugin path deletes the anonymous account itself through
   * the internal adapter (which also cleans sessions and credentials), so it
   * passes `false`. Trigger callers pass `true` to consume the shadow here.
   */
  deleteShadowUser: boolean;
}) =>
  Effect.gen(function* () {
    if (shadowUserId === realUserId) {
      return emptyCounts();
    }

    return yield* transaction(
      Effect.gen(function* () {
        const db = yield* currentDb;
        const now = yield* DateTime.nowAsDate;

        const realUsers = yield* db
          .select()
          .from(schema.userTable)
          .where(eq(schema.userTable.id, realUserId))
          .limit(1);
        const realUser = realUsers[0];
        if (!realUser) {
          return yield* new SubjectNotFoundError({
            message: "Cannot heal a shadow user into an account that does not exist",
          });
        }

        // Captured before the reassignment so the orgs (and contact emails)
        // that pointed at the shadow remain known for subscription activation.
        const healedContacts = yield* db
          .select({
            organizationId: schema.contactTable.organizationId,
            email: schema.contactTable.email,
          })
          .from(schema.contactTable)
          .where(eq(schema.contactTable.userId, shadowUserId));

        const movedContacts = yield* db
          .update(schema.contactTable)
          .set({ userId: realUserId, updatedAt: now })
          .where(eq(schema.contactTable.userId, shadowUserId))
          .returning({ id: schema.contactTable.id });

        const movedPosts = yield* db
          .update(schema.postTable)
          .set({ creatorId: realUserId, updatedAt: now })
          .where(eq(schema.postTable.creatorId, shadowUserId))
          .returning({ id: schema.postTable.id });

        const droppedUpvotes = yield* db
          .delete(schema.upvoteTable)
          .where(
            and(
              eq(schema.upvoteTable.userId, shadowUserId),
              inArray(
                schema.upvoteTable.postId,
                db
                  .select({ postId: schema.upvoteTable.postId })
                  .from(schema.upvoteTable)
                  .where(eq(schema.upvoteTable.userId, realUserId))
              )
            )
          )
          .returning({ id: schema.upvoteTable.id });

        const movedUpvotes = yield* db
          .update(schema.upvoteTable)
          .set({ updatedAt: now, userId: realUserId })
          .where(eq(schema.upvoteTable.userId, shadowUserId))
          .returning({ id: schema.upvoteTable.id });

        const movedComments = yield* db
          .update(schema.commentTable)
          .set({ updatedAt: now, userId: realUserId })
          .where(eq(schema.commentTable.userId, shadowUserId))
          .returning({ id: schema.commentTable.id });

        const droppedPostSubscriptions = yield* db
          .delete(schema.postSubscriptionTable)
          .where(
            and(
              eq(schema.postSubscriptionTable.userId, shadowUserId),
              inArray(
                schema.postSubscriptionTable.postId,
                db
                  .select({ postId: schema.postSubscriptionTable.postId })
                  .from(schema.postSubscriptionTable)
                  .where(eq(schema.postSubscriptionTable.userId, realUserId))
              )
            )
          )
          .returning({ id: schema.postSubscriptionTable.id });

        const movedPostSubscriptions = yield* db
          .update(schema.postSubscriptionTable)
          .set({ updatedAt: now, userId: realUserId })
          .where(eq(schema.postSubscriptionTable.userId, shadowUserId))
          .returning({ id: schema.postSubscriptionTable.id });

        // Email-keyed subscriptions hang off `email_contact`, not the user;
        // the identity reference moves unconditionally, activation is gated.
        yield* db
          .update(schema.emailContactTable)
          .set({ updatedAt: now, userId: realUserId })
          .where(eq(schema.emailContactTable.userId, shadowUserId));

        let subscriptionsActivated = 0;
        for (const contact of healedContacts) {
          if (!contact.email || isSyntheticEmail(contact.email)) {
            continue;
          }

          const isMember = yield* isOrganizationMember(
            realUserId,
            contact.organizationId
          );
          const eligible =
            realUser.emailVerified &&
            (isMember ||
              realUser.restrictedToOrganizationId === contact.organizationId ||
              realUser.restrictedToOrganizationId === null);

          const emailContacts = yield* db
            .select({ id: schema.emailContactTable.id })
            .from(schema.emailContactTable)
            .where(
              and(
                eq(
                  schema.emailContactTable.organizationId,
                  contact.organizationId
                ),
                sql`lower(${schema.emailContactTable.email}) = ${contact.email.toLowerCase()}`
              )
            )
            .limit(1);
          const emailContact = emailContacts[0];
          if (!emailContact) {
            continue;
          }

          if (eligible) {
            const activated = yield* db
              .update(schema.emailSubscriptionTable)
              .set({ state: "active", updatedAt: now, verifiedAt: now })
              .where(
                and(
                  eq(
                    schema.emailSubscriptionTable.contactId,
                    emailContact.id
                  ),
                  eq(
                    schema.emailSubscriptionTable.state,
                    "deferred_no_access"
                  )
                )
              )
              .returning({ id: schema.emailSubscriptionTable.id });
            subscriptionsActivated += activated.length;

            // Mirror `requestSubscription`'s verified path: an eligible
            // surviving account owns the address and proves it verified.
            // Ineligible accounts leave the row untouched.
            yield* db
              .update(schema.emailContactTable)
              .set({
                userId: realUserId,
                verificationState: "verified",
                verifiedAt: now,
                updatedAt: now,
              })
              .where(eq(schema.emailContactTable.id, emailContact.id));
          }
        }

        if (deleteShadowUser) {
          yield* db
            .delete(schema.userTable)
            .where(eq(schema.userTable.id, shadowUserId));
        }

        return {
          contacts: movedContacts.length,
          posts: movedPosts.length,
          upvotesMoved: movedUpvotes.length,
          upvotesDropped: droppedUpvotes.length,
          comments: movedComments.length,
          postSubscriptionsMoved: movedPostSubscriptions.length,
          postSubscriptionsDropped: droppedPostSubscriptions.length,
          subscriptionsActivated,
        } satisfies HealedIdentityCounts;
      })
    );
  });

const isOrganizationMember = (userId: string, organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const rows = yield* db
      .select({ id: schema.memberTable.id })
      .from(schema.memberTable)
      .where(
        and(
          eq(schema.memberTable.userId, userId),
          eq(schema.memberTable.organizationId, organizationId)
        )
      )
      .limit(1);
    return rows.length > 0;
  });

/**
 * Signup / email-verification trigger. Finds contacts in the user's member
 * organizations whose email matches the account exactly and whose linked user
 * is a `behalf-*` shadow, then heals each one independently. Guards:
 *
 * - Runs only for verified accounts (callers may invoke it optimistically on
 *   user creation; unverified accounts no-op).
 * - Emails must match — contacts are found by equality with the account
 *   email, so a different address can never claim another identity.
 * - Only shadow links are consumed; contacts pointing at SSO portal users or
 *   real accounts are left untouched.
 */
export const healShadowsForVerifiedUser = ({ userId }: { userId: string }) =>
  Effect.gen(function* () {
    const db = yield* currentDb;

    const users = yield* db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.id, userId))
      .limit(1);
    const user = users[0];
    if (!user || !user.emailVerified) {
      return { organizationIds: [], totals: emptyCounts() } satisfies ShadowHealSummary;
    }

    const memberships = yield* db
      .select({ organizationId: schema.memberTable.organizationId })
      .from(schema.memberTable)
      .where(eq(schema.memberTable.userId, userId));

    const organizationIds: Array<string> = [];
    let totals = emptyCounts();

    for (const { organizationId } of memberships) {
      const candidates = yield* db
        .select({ id: schema.contactTable.id, userId: schema.contactTable.userId })
        .from(schema.contactTable)
        .where(
          and(
            eq(schema.contactTable.organizationId, organizationId),
            sql`lower(${schema.contactTable.email}) = ${user.email.toLowerCase()}`
          )
        );

      for (const candidate of candidates) {
        if (!candidate.userId || candidate.userId === userId) {
          continue;
        }
        const linkedUsers = yield* db
          .select({ email: schema.userTable.email })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, candidate.userId))
          .limit(1);
        const linked = linkedUsers[0];
        if (!(linked && isShadowUserEmail(linked.email))) {
          continue;
        }

        const counts = yield* linkShadowUser({
          shadowUserId: candidate.userId,
          realUserId: userId,
          deleteShadowUser: true,
        });
        organizationIds.push(organizationId);
        totals = addCounts(totals, counts);
      }
    }

    return { organizationIds, totals } satisfies ShadowHealSummary;
  });
