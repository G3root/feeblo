import { currentDb, schema, transaction } from "@feeblo/db";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { hashEmail } from "../user/repository";
import { isShadowUserEmail, isSyntheticEmail } from "./emails";
import { SubjectNotFoundError } from "./errors";

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

/** Organizations whose deferred subscriptions a verification trigger touched. */
export interface DeferredActivationSummary {
  /** Organizations that had at least one subscription activated. */
  readonly organizationIds: ReadonlyArray<string>;
  /** `deferred_no_access` rows moved to `active`. */
  readonly subscriptionsActivated: number;
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
  subscriptionsActivated: a.subscriptionsActivated + b.subscriptionsActivated,
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
 *    AND member ∨ SSO-bound-to-org ∨ unrestricted global on a PUBLIC board,
 *    mirroring the delivery gate in `email-outbox/access.ts`).
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
            message:
              "Cannot heal a shadow user into an account that does not exist",
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
          // Activation must only ever verify an address the surviving
          // account proved; callers may link identities whose emails differ
          // in case, never in substance.
          subscriptionsActivated +=
            yield* activateDeferredSubscriptionsForContact({
              addressProved:
                realUser.emailVerified &&
                realUser.email.toLowerCase() === contact.email.toLowerCase(),
              contactEmail: contact.email,
              now,
              organizationId: contact.organizationId,
              realUser,
            });
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
 * Activates the deferred email subscriptions one customer contact holds, once
 * the surviving account satisfies the notification-eligibility rule
 * (`email-outbox/access.ts`): the account proved the address, and it is a
 * member, SSO-bound to the organization, or an unrestricted global user whose
 * post sits on a PUBLIC board. Claims the `email_contact` row for the account
 * when eligibility holds; leaves it untouched otherwise. Returns the number
 * of `deferred_no_access` rows moved to `active` (zero when the address is
 * unproved or ineligible).
 *
 * Shared by shadow healing and the verification trigger, so the two triggers
 * cannot disagree about who may be emailed. Runs on the caller's transaction
 * through the fiber-local connection.
 */
const activateDeferredSubscriptionsForContact = (args: {
  /**
   * Whether the surviving account proved it owns this address. The caller
   * decides what counts as proof: an exact verified email match, or an
   * SSO-bound portal identity whose contact link carries the address.
   */
  readonly addressProved: boolean;
  readonly contactEmail: string;
  readonly now: Date;
  readonly organizationId: string;
  readonly realUser: typeof schema.userTable.$inferSelect;
}) =>
  Effect.gen(function* () {
    // No proof, no activation: every eligibility branch below requires it.
    // Returning first keeps an unproved contact from paying for a membership
    // read and an address lookup whose answer nothing can use.
    if (!args.addressProved) {
      return 0;
    }

    const db = yield* currentDb;
    const { contactEmail, now, organizationId, realUser } = args;

    const isMember = yield* isOrganizationMember(realUser.id, organizationId);
    const isSsoBound = realUser.restrictedToOrganizationId === organizationId;
    const isUnrestrictedGlobal = realUser.restrictedToOrganizationId === null;
    const eligibleDirect = isMember || isSsoBound;
    const eligibleGlobalDeferred =
      !isMember && !isSsoBound && isUnrestrictedGlobal;

    const emailContacts = yield* db
      .select({ id: schema.emailContactTable.id })
      .from(schema.emailContactTable)
      .where(
        and(
          eq(schema.emailContactTable.organizationId, organizationId),
          sql`lower(${schema.emailContactTable.email}) = ${contactEmail.toLowerCase()}`
        )
      )
      .limit(1);
    const emailContact = emailContacts[0];
    if (!emailContact) {
      return 0;
    }

    if (eligibleDirect) {
      const activated = yield* db
        .update(schema.emailSubscriptionTable)
        .set({ state: "active", updatedAt: now, verifiedAt: now })
        .where(
          and(
            eq(schema.emailSubscriptionTable.contactId, emailContact.id),
            eq(schema.emailSubscriptionTable.organizationId, organizationId),
            eq(schema.emailSubscriptionTable.state, "deferred_no_access")
          )
        )
        .returning({ id: schema.emailSubscriptionTable.id });

      // Mirror `requestSubscription`'s verified path: an eligible surviving
      // account owns the address and proves it verified. Ineligible accounts
      // leave the row untouched.
      yield* db
        .update(schema.emailContactTable)
        .set({
          userId: realUser.id,
          verificationState: "verified",
          verifiedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.emailContactTable.id, emailContact.id));
      return activated.length;
    }

    if (!eligibleGlobalDeferred) {
      return 0;
    }

    // Unrestricted globals pass the delivery gate only on PUBLIC boards:
    // activate deferred post subscriptions per post instead of
    // bulk-activating private-board rows that could never deliver.
    const deferred = yield* db
      .select({
        id: schema.emailSubscriptionTable.id,
        topicId: schema.emailSubscriptionTable.topicId,
        topicType: schema.emailSubscriptionTable.topicType,
      })
      .from(schema.emailSubscriptionTable)
      .where(
        and(
          eq(schema.emailSubscriptionTable.contactId, emailContact.id),
          eq(schema.emailSubscriptionTable.organizationId, organizationId),
          eq(schema.emailSubscriptionTable.state, "deferred_no_access")
        )
      );
    const postIds = deferred.flatMap((row) =>
      row.topicType === "post" && row.topicId !== null ? [row.topicId] : []
    );
    if (postIds.length === 0) {
      return 0;
    }
    const publicPosts = yield* db
      .select({ id: schema.postTable.id })
      .from(schema.postTable)
      .innerJoin(
        schema.boardTable,
        eq(schema.boardTable.id, schema.postTable.boardId)
      )
      .where(
        and(
          eq(schema.postTable.organizationId, organizationId),
          inArray(schema.postTable.id, postIds),
          // Board visibility, not `publicPostVisibility`: activation is about
          // who may be emailed, and the outbox re-checks visibility on every
          // delivery attempt (`email-outbox/access.ts`, rule 3). Filtering on
          // the post's current state would latch an archived or merged post
          // into `deferred_no_access` forever, because restoring or unmerging
          // it never retries activation.
          eq(schema.boardTable.visibility, "PUBLIC")
        )
      );
    const publicIds = new Set(publicPosts.map((row) => row.id));
    const activatable = deferred
      .filter((row) => row.topicId !== null && publicIds.has(row.topicId))
      .map((row) => row.id);
    if (activatable.length === 0) {
      return 0;
    }
    const activated = yield* db
      .update(schema.emailSubscriptionTable)
      .set({ state: "active", updatedAt: now, verifiedAt: now })
      .where(
        and(
          eq(schema.emailSubscriptionTable.contactId, emailContact.id),
          eq(schema.emailSubscriptionTable.organizationId, organizationId),
          eq(schema.emailSubscriptionTable.state, "deferred_no_access"),
          inArray(schema.emailSubscriptionTable.id, activatable)
        )
      )
      .returning({ id: schema.emailSubscriptionTable.id });
    if (activated.length > 0) {
      yield* db
        .update(schema.emailContactTable)
        .set({
          userId: realUser.id,
          verificationState: "verified",
          verifiedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.emailContactTable.id, emailContact.id));
    }
    return activated.length;
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
 * - Shadows with no contact left (their CRM record was deleted while
 *   attributed content kept them alive) are found by email hash, so removing a
 *   customer cannot strand an identity that signs up later.
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
      return {
        organizationIds: [],
        totals: emptyCounts(),
      } satisfies ShadowHealSummary;
    }

    // Candidate organizations come from contacts matching the account email,
    // NOT from memberships: an attributed customer who signs up is rarely a
    // workspace member, so membership-scoped discovery would heal nothing.
    // Members keep their own contact matches through the same query.
    const contactOrganizations = yield* db
      .select({
        organizationId: schema.contactTable.organizationId,
      })
      .from(schema.contactTable)
      .where(
        sql`lower(${schema.contactTable.email}) = ${user.email.toLowerCase()}`
      )
      .groupBy(schema.contactTable.organizationId);

    const organizationIds: Array<string> = [];
    let totals = emptyCounts();

    for (const { organizationId } of contactOrganizations) {
      const candidates = yield* db
        .select({
          id: schema.contactTable.id,
          userId: schema.contactTable.userId,
        })
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

    // The contact scan cannot see a shadow whose contact was deleted while
    // attributed content kept the account alive (deleting a contact only nulls
    // `post.contact_id`). Without this pass, signing up after a CRM cleanup
    // would leave the person's own posts and votes owned by an account they can
    // never sign in to. The email hash is the same proof the scan uses.
    const currentEmailHash = yield* hashEmail(user.email);
    const survivingShadows = yield* db
      .select({
        email: schema.userTable.email,
        id: schema.userTable.id,
        organizationId: schema.userTable.restrictedToOrganizationId,
      })
      .from(schema.userTable)
      .where(
        and(
          eq(schema.userTable.emailHash, currentEmailHash),
          isNotNull(schema.userTable.restrictedToOrganizationId)
        )
      );

    for (const shadow of survivingShadows) {
      // A portal (`sso-*`) account is a proven identity, not an attribution
      // shim; only shadows are consumed here.
      if (!isShadowUserEmail(shadow.email)) {
        continue;
      }
      const organizationId = shadow.organizationId;
      if (organizationId === null) {
        continue;
      }
      const counts = yield* linkShadowUser({
        shadowUserId: shadow.id,
        realUserId: userId,
        deleteShadowUser: true,
      });
      organizationIds.push(organizationId);
      totals = addCounts(totals, counts);
    }

    return { organizationIds, totals } satisfies ShadowHealSummary;
  });

/**
 * Signup / email-verification trigger for attributed subjects that have no
 * shadow identity to heal.
 *
 * A customer who was attributed by a bare email or an external id has a
 * contact but no shadow user, so {@link healShadowsForVerifiedUser} finds
 * nothing to link. Their subscription still sits at `deferred_no_access`,
 * and the outbox skips it: the fan-out reads `active` rows only. The
 * documented rule is that gaining access later resumes delivery, so this
 * trigger activates the deferred rows of every contact whose email the
 * account just proved, exactly as a shadow heal would.
 *
 * Guards:
 *
 * - Runs only for a verified account. An email match is trusted only when the
 *   account's own address is real: a `behalf-*` or `sso-*` synthetic inbox
 *   proves nothing by string match. An SSO-bound account is proved instead by
 *   the workspace's identity provider, through the contact link its token
 *   created.
 * - Contacts are found by the account's email or its own link, so a different
 *   address can never claim another person's subscriptions.
 * - Eligibility is re-evaluated per contact by the shared activation helper;
 *   a contact whose organization the account cannot reach is left deferred.
 */
export const activateDeferredSubscriptionsForVerifiedUser = ({
  userId,
}: {
  userId: string;
}) =>
  Effect.gen(function* () {
    const db = yield* currentDb;

    const users = yield* db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.id, userId))
      .limit(1);
    const user = users[0];
    // A synthetic inbox (`behalf-*`, `sso-*`) never proves an address by
    // itself, but an SSO-bound account is proved by the workspace's own
    // identity provider and its contact link carries the address.
    if (!user || !user.emailVerified) {
      const nothingActivated: DeferredActivationSummary = {
        organizationIds: [],
        subscriptionsActivated: 0,
      };
      return nothingActivated;
    }

    const contacts = yield* db
      .select({
        email: schema.contactTable.email,
        organizationId: schema.contactTable.organizationId,
        userId: schema.contactTable.userId,
      })
      .from(schema.contactTable)
      .where(
        and(
          isNotNull(schema.contactTable.email),
          or(
            sql`lower(${schema.contactTable.email}) = ${user.email.toLowerCase()}`,
            eq(schema.contactTable.userId, userId)
          )
        )
      );

    const organizationIds: Array<string> = [];
    let subscriptionsActivated = 0;
    const now = yield* DateTime.nowAsDate;
    // An address match is evidence only when it is the account's own real
    // address; a synthetic inbox proves nothing by string comparison.
    const accountEmail = isSyntheticEmail(user.email)
      ? null
      : user.email.toLowerCase();
    for (const contact of contacts) {
      if (!contact.email || isSyntheticEmail(contact.email)) {
        continue;
      }
      const provedByEmail =
        accountEmail !== null && accountEmail === contact.email.toLowerCase();
      // The portal identity was created from the workspace's signed token and
      // the contact link came from the same token, so the address is proved by
      // the identity provider rather than by an email match.
      const provedBySso =
        contact.userId === userId &&
        user.restrictedToOrganizationId === contact.organizationId;
      const activated = yield* activateDeferredSubscriptionsForContact({
        addressProved: provedByEmail || provedBySso,
        contactEmail: contact.email,
        now,
        organizationId: contact.organizationId,
        realUser: user,
      });
      if (activated > 0) {
        subscriptionsActivated += activated;
        organizationIds.push(contact.organizationId);
      }
    }

    return { organizationIds, subscriptionsActivated };
  });
