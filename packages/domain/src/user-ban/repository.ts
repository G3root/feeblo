import { currentDb, schema, transaction } from "@feeblo/db";
import { normalizeEmailAddress } from "@feeblo/db/validation-schema/email";
import { UserBanId } from "@feeblo/id";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { UserBanDataError } from "./errors";
import type { UserBanListRequest, UserBanTarget } from "./schema";
import { normalizeBanEmail } from "./schema";

const table = schema.userBanTable;

/**
 * How far the reply re-anchor above a banned person's comments will climb.
 *
 * Each pass lifts one level, and a comment thread is a forest, so the bound is
 * only a guard against a cycle a bad write could create. Any reply still
 * pointing at a removed comment when the bound is reached is re-anchored to
 * the thread root instead, so the delete never has to cascade through someone
 * else's words.
 */
const MAX_REPLY_REANCHOR_PASSES = 100;

/** A stored ban, before the display names the list joins in. */
export type UserBanStoredRow = {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string | null;
  readonly email: string | null;
  readonly reason: string | null;
  readonly createdByMemberId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

/** A stored ban plus the display names the dashboard's list joins in. */
export type UserBanRow = UserBanStoredRow & {
  readonly userName: string | null;
  readonly createdByName: string | null;
};

/** The identity a ban check is performed against. */
export type UserBanLookup = {
  readonly organizationId: string;
  readonly userId?: string | null;
  readonly email?: string | null;
  /** Resolved to the contact's account and address before the check. */
  readonly contactId?: string | null;
};

/**
 * The result of resolving an operator's target to the keys a ban stores.
 *
 * `member` is separate from `not_found`: a workspace member is a real user, but
 * banning them is the wrong tool — membership removal is. `unresolvable` is a
 * contact with neither an account nor an address, which the operator has to fix
 * in the CRM first.
 */
export type ResolvedBanTarget =
  | {
      readonly status: "ok";
      readonly userId: string | null;
      readonly email: string | null;
      readonly name: string | null;
    }
  | { readonly status: "not_found" }
  | { readonly status: "member" }
  | { readonly status: "unresolvable" };

/** What a content purge removed, so the response can say so. */
export type PurgedBanContent = {
  readonly comments: number;
  readonly posts: number;
};

export type UpsertUserBanInput = {
  readonly organizationId: string;
  readonly userId: string | null;
  readonly email: string | null;
  readonly reason: string | null;
  readonly createdByMemberId: string | null;
  readonly now: Date;
};

const dataError = (operation: string, reason: string): UserBanDataError =>
  new UserBanDataError({ operation, reason });

const escapeLikePattern = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

const normalizedEmail = (email: string | null | undefined): string | null =>
  email === null || email === undefined ? null : normalizeEmailAddress(email);

const makeUserBanRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  const isWorkspaceMember = (input: {
    readonly organizationId: string;
    readonly userId: string;
  }) =>
    Effect.gen(function* () {
      const [row] = yield* db
        .select({ id: schema.memberTable.id })
        .from(schema.memberTable)
        .where(
          and(
            eq(schema.memberTable.organizationId, input.organizationId),
            eq(schema.memberTable.userId, input.userId)
          )
        )
        .limit(1);
      return row !== undefined;
    });

  /** A contact row that links this account to the workspace, if one exists. */
  const findContactByUserId = (input: {
    readonly organizationId: string;
    readonly userId: string;
  }) =>
    Effect.gen(function* () {
      const [contact] = yield* db
        .select({ name: schema.contactTable.name })
        .from(schema.contactTable)
        .where(
          and(
            eq(schema.contactTable.organizationId, input.organizationId),
            eq(schema.contactTable.userId, input.userId)
          )
        )
        .limit(1);
      return contact;
    });

  /** An account by normalized address, with the tenancy field its callers need. */
  const findUserByEmail = (email: string) =>
    db
      .select({
        id: schema.userTable.id,
        name: schema.userTable.name,
        restrictedToOrganizationId: schema.userTable.restrictedToOrganizationId,
      })
      .from(schema.userTable)
      .where(sql`lower(${schema.userTable.email}) = ${email}`)
      .limit(1)
      .pipe(Effect.map((rows) => rows[0]));

  /** Resolves a lookup's contact facet into the account and address it names. */
  const resolveLookup = (input: UserBanLookup) =>
    Effect.gen(function* () {
      let userId = input.userId ?? null;
      let email = normalizedEmail(input.email);

      if (input.contactId) {
        const [contact] = yield* db
          .select({
            email: schema.contactTable.email,
            userId: schema.contactTable.userId,
          })
          .from(schema.contactTable)
          .where(
            and(
              eq(schema.contactTable.id, input.contactId),
              eq(schema.contactTable.organizationId, input.organizationId)
            )
          )
          .limit(1);
        if (contact !== undefined) {
          userId ??= contact.userId;
          email ??= normalizedEmail(contact.email);
        }
      }

      return { email, userId };
    });

  /**
   * Whether this identity is banned in this workspace.
   *
   * A missing identity is never banned: an anonymous widget submission has
   * nobody to check. The predicate is an OR over the two facets, so a ban by
   * address still applies to an account created after it.
   */
  const isBanned = Effect.fn("UserBanRepository.isBanned")(function* (
    input: UserBanLookup
  ) {
    const { email, userId } = yield* resolveLookup(input);
    const facets = [
      ...(userId === null ? [] : [eq(table.userId, userId)]),
      ...(email === null ? [] : [eq(table.email, email)]),
    ];
    if (facets.length === 0) {
      return false;
    }

    const [row] = yield* db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.organizationId, input.organizationId), or(...facets)))
      .limit(1);
    return row !== undefined;
  });

  /**
   * Whether the identity is a workspace member.
   *
   * The session path checks membership before it calls the policy, but the
   * widget has no session: a contact linked to a member (or an address that
   * belongs to a member) must bypass an address-only ban here for the same
   * reason `canParticipate` bypasses it for a member's session.
   */
  const isMember = Effect.fn("UserBanRepository.isMember")(function* (
    input: UserBanLookup
  ) {
    const { email, userId } = yield* resolveLookup(input);
    if (userId !== null) {
      return yield* isWorkspaceMember({
        organizationId: input.organizationId,
        userId,
      });
    }
    if (email === null) {
      return false;
    }
    const user = yield* findUserByEmail(email);
    if (user === undefined) {
      return false;
    }
    return yield* isWorkspaceMember({
      organizationId: input.organizationId,
      userId: user.id,
    });
  });

  /**
   * Resolves an account id to a ban subject, or refuses it.
   *
   * A caller-supplied user id is only addressable from this workspace when the
   * account is related to it: a restricted portal identity, a membership
   * (refused as `member`), or a contact row. An unrelated account is reported
   * as not found rather than revealing its name and address to this tenant.
   *
   * `requireRelated` is false when the server itself resolved the id from a
   * participation row (a comment or a post in this workspace). That row is
   * already proof that the person interacted here, and the client never gets
   * to name the id, so the tenant-isolation guard has nothing left to protect.
   */
  const resolveUserTarget = (input: {
    readonly organizationId: string;
    readonly requireRelated: boolean;
    readonly userId: string;
  }) =>
    Effect.gen(function* () {
      const [user] = yield* db
        .select({
          email: schema.userTable.email,
          id: schema.userTable.id,
          name: schema.userTable.name,
          restrictedToOrganizationId:
            schema.userTable.restrictedToOrganizationId,
        })
        .from(schema.userTable)
        .where(eq(schema.userTable.id, input.userId))
        .limit(1);
      if (user === undefined) {
        return { status: "not_found" } as const;
      }
      const member = yield* isWorkspaceMember({
        organizationId: input.organizationId,
        userId: user.id,
      });
      if (member) {
        return { status: "member" } as const;
      }

      const contact = yield* findContactByUserId({
        organizationId: input.organizationId,
        userId: user.id,
      });
      const related =
        user.restrictedToOrganizationId === input.organizationId ||
        contact !== undefined;
      if (input.requireRelated && !related) {
        return { status: "not_found" } as const;
      }

      // The ban stores the account address. A linked contact may have a
      // different address; the widget's ban check resolves that contact's
      // userId, so the account facet covers it without a second address row.
      return {
        email: normalizedEmail(user.email),
        name: contact?.name ?? user.name,
        status: "ok",
        userId: user.id,
      } as const;
    });

  /**
   * Resolves the operator's target to the account and address a ban stores.
   *
   * A contact is a CRM row and may not have an account (or an address); the
   * repository reports that rather than writing a ban with no subject. A
   * user who is a member of the workspace is rejected because membership
   * removal is the correct operation for staff.
   */
  const resolveTarget = Effect.fn("UserBanRepository.resolveTarget")(
    function* (input: {
      readonly organizationId: string;
      readonly target: UserBanTarget;
    }) {
      const target = input.target;

      // A moderation menu names the comment, not the account: the author is
      // read from a row this workspace owns, so the request cannot probe
      // another tenant's accounts by id.
      if (target._tag === "comment") {
        const [comment] = yield* db
          .select({ userId: schema.commentTable.userId })
          .from(schema.commentTable)
          .where(
            and(
              eq(schema.commentTable.id, target.commentId),
              eq(schema.commentTable.organizationId, input.organizationId)
            )
          )
          .limit(1);
        if (comment === undefined) {
          return { status: "not_found" } as const;
        }
        return yield* resolveUserTarget({
          organizationId: input.organizationId,
          requireRelated: false,
          userId: comment.userId,
        });
      }

      // A post is the same proof as a comment: the author is read from a row
      // this workspace owns, so a post created here is bannable here.
      if (target._tag === "post") {
        const [post] = yield* db
          .select({ creatorId: schema.postTable.creatorId })
          .from(schema.postTable)
          .where(
            and(
              eq(schema.postTable.id, target.postId),
              eq(schema.postTable.organizationId, input.organizationId)
            )
          )
          .limit(1);
        if (post === undefined || post.creatorId === null) {
          return { status: "not_found" } as const;
        }
        return yield* resolveUserTarget({
          organizationId: input.organizationId,
          requireRelated: false,
          userId: post.creatorId,
        });
      }

      if (target._tag === "email") {
        const email = normalizeBanEmail(target.email);

        // A workspace contact is the strongest relationship the address can
        // have: it is already the workspace's record of this person. A
        // contact with no linked account never adopts a same-address global
        // account — the ban stays address-scoped and does not reach an
        // account the workspace has no relationship with.
        const [contact] = yield* db
          .select({
            name: schema.contactTable.name,
            userId: schema.contactTable.userId,
          })
          .from(schema.contactTable)
          .where(
            and(
              eq(schema.contactTable.organizationId, input.organizationId),
              sql`lower(${schema.contactTable.email}) = ${email}`
            )
          )
          // Both rows can exist because the contact unique index is
          // case-sensitive while the lookup is not. A linked row is the
          // stronger relationship, so it wins the arbitrary-order tie.
          .orderBy(asc(sql`${schema.contactTable.userId} is null`))
          .limit(1);
        if (contact !== undefined) {
          if (contact.userId === null) {
            // The contact is unlinked, but its address may still belong to a
            // workspace member. Do not create an address-only ban for a
            // member; the RPC would otherwise claim to ban staff.
            const user = yield* findUserByEmail(email);
            if (user !== undefined) {
              const member = yield* isWorkspaceMember({
                organizationId: input.organizationId,
                userId: user.id,
              });
              if (member) {
                return { status: "member" } as const;
              }
            }
            return {
              email,
              name: contact.name,
              status: "ok",
              userId: null,
            } as const;
          }
          const member = yield* isWorkspaceMember({
            organizationId: input.organizationId,
            userId: contact.userId,
          });
          if (member) {
            return { status: "member" } as const;
          }
          const [user] = yield* db
            .select({ name: schema.userTable.name })
            .from(schema.userTable)
            .where(eq(schema.userTable.id, contact.userId))
            .limit(1);
          return {
            email,
            name: contact.name ?? user?.name ?? null,
            status: "ok",
            userId: contact.userId,
          } as const;
        }

        // No contact: an account may still be banned by address if it is
        // related to this workspace through a restricted identity or a
        // membership. An unrelated global account is not adopted by address.
        const user = yield* findUserByEmail(email);
        if (user !== undefined) {
          const member = yield* isWorkspaceMember({
            organizationId: input.organizationId,
            userId: user.id,
          });
          if (member) {
            return { status: "member" } as const;
          }
          const contact = yield* findContactByUserId({
            organizationId: input.organizationId,
            userId: user.id,
          });
          const related =
            user.restrictedToOrganizationId === input.organizationId ||
            contact !== undefined;
          if (related) {
            return {
              email,
              name: contact?.name ?? user.name,
              status: "ok",
              userId: user.id,
            } as const;
          }
        }

        return { email, name: null, status: "ok", userId: null } as const;
      }

      if (target._tag === "user") {
        return yield* resolveUserTarget({
          organizationId: input.organizationId,
          requireRelated: true,
          userId: target.userId,
        });
      }

      const [contact] = yield* db
        .select({
          email: schema.contactTable.email,
          name: schema.contactTable.name,
          userId: schema.contactTable.userId,
        })
        .from(schema.contactTable)
        .where(
          and(
            eq(schema.contactTable.id, target.contactId),
            eq(schema.contactTable.organizationId, input.organizationId)
          )
        )
        .limit(1);
      if (contact === undefined) {
        return { status: "not_found" } as const;
      }

      let user: { email: string; name: string | null } | undefined;
      if (contact.userId) {
        const [row] = yield* db
          .select({
            email: schema.userTable.email,
            name: schema.userTable.name,
          })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, contact.userId))
          .limit(1);
        user = row;
        if (user !== undefined) {
          const member = yield* isWorkspaceMember({
            organizationId: input.organizationId,
            userId: contact.userId,
          });
          if (member) {
            return { status: "member" } as const;
          }
        }
      }

      const email = normalizedEmail(contact.email ?? user?.email);
      const userId = contact.userId ?? null;
      if (email === null && userId === null) {
        return { status: "unresolvable" } as const;
      }
      return {
        email,
        name: contact.name ?? user?.name ?? null,
        status: "ok",
        userId,
      } as const;
    }
  );

  /**
   * Writes one ban, merging the account and address facets onto one row.
   *
   * The insert is the common path. A conflict means another facet of the same
   * person is already banned; the transaction then deletes the duplicate rows
   * before filling the missing facet on the survivor, so both unique indexes
   * stay satisfied. The whole thing is database work, so the transaction
   * retry (ADR 0020) can replay it.
   */
  const upsert = Effect.fn("UserBanRepository.upsert")(function* (
    input: UpsertUserBanInput
  ) {
    const email = normalizedEmail(input.email);
    if (input.userId === null && email === null) {
      return yield* dataError(
        "upsert",
        "A ban needs an account or an email address"
      );
    }

    return yield* transaction(
      Effect.gen(function* () {
        const [inserted] = yield* db
          .insert(table)
          .values({
            id: yield* UserBanId.generate,
            createdByMemberId: input.createdByMemberId,
            createdAt: input.now,
            email,
            organizationId: input.organizationId,
            reason: input.reason,
            updatedAt: input.now,
            userId: input.userId,
          })
          .onConflictDoNothing()
          .returning();
        if (inserted !== undefined) {
          return inserted;
        }

        const facets = [
          ...(input.userId === null ? [] : [eq(table.userId, input.userId)]),
          ...(email === null ? [] : [eq(table.email, email)]),
        ];
        const rows = yield* db
          .select()
          .from(table)
          .where(
            and(eq(table.organizationId, input.organizationId), or(...facets))
          )
          .orderBy(asc(table.createdAt), asc(table.id))
          .for("update");
        const [keeper, ...duplicates] = rows;
        if (keeper === undefined) {
          return yield* dataError(
            "upsert",
            "A ban conflict did not resolve to a stored row"
          );
        }

        if (duplicates.length > 0) {
          yield* db.delete(table).where(
            inArray(
              table.id,
              duplicates.map((row) => row.id)
            )
          );
        }

        const [updated] = yield* db
          .update(table)
          .set({
            // The facets on the row being written win. A ban named by a
            // contact carries that contact's address, and the duplicate this
            // merge deletes may be the only row holding it; keeping the
            // survivor's older address would silently unban the address the
            // operator just named. Nothing is lost from the other side: an
            // identity with the older address resolves to the account, and
            // the account facet is kept.
            email: email ?? keeper.email,
            reason: input.reason ?? keeper.reason,
            updatedAt: input.now,
            userId: input.userId ?? keeper.userId,
          })
          .where(eq(table.id, keeper.id))
          .returning();
        if (updated === undefined) {
          return yield* dataError(
            "upsert",
            "A ban update did not resolve to a stored row"
          );
        }
        return updated;
      })
    );
  });

  /**
   * Removes the participation a ban makes meaningless.
   *
   * A ban stops the person writing, so the vote counts and the notifications
   * that would keep pulling them back go with it: every upvote they cast in
   * this workspace, every post and changelog they follow, and every email
   * subscription tied to their account or their address. Email rows are marked
   * `unsubscribed` rather than deleted because the table models a consent
   * decision and a re-subscribe has to be verified again; the follow rows carry
   * no history, so they are deleted.
   *
   * An address-only ban has no account, so there is nothing to strip.
   */
  const clearVotesAndSubscriptions = Effect.fn(
    "UserBanRepository.clearVotesAndSubscriptions"
  )(function* (input: {
    readonly organizationId: string;
    readonly userId: string;
    readonly email: string | null;
    readonly now: Date;
  }) {
    const removedUpvotes = yield* db
      .delete(schema.upvoteTable)
      .where(
        and(
          eq(schema.upvoteTable.organizationId, input.organizationId),
          eq(schema.upvoteTable.userId, input.userId)
        )
      )
      .returning({ id: schema.upvoteTable.id });

    const removedPostSubscriptions = yield* db
      .delete(schema.postSubscriptionTable)
      .where(
        and(
          eq(schema.postSubscriptionTable.organizationId, input.organizationId),
          eq(schema.postSubscriptionTable.userId, input.userId)
        )
      )
      .returning({ id: schema.postSubscriptionTable.id });

    const removedChangelogSubscriptions = yield* db
      .delete(schema.changelogSubscriptionTable)
      .where(
        and(
          eq(
            schema.changelogSubscriptionTable.organizationId,
            input.organizationId
          ),
          eq(schema.changelogSubscriptionTable.userId, input.userId)
        )
      )
      .returning({ id: schema.changelogSubscriptionTable.id });

    // The email side is keyed by the address's contact row, not by the
    // account, so a contact linked to the account or carrying the same
    // normalized address is the same person here.
    const email = normalizedEmail(input.email);
    const contactIds = yield* db
      .select({ id: schema.emailContactTable.id })
      .from(schema.emailContactTable)
      .where(
        and(
          eq(schema.emailContactTable.organizationId, input.organizationId),
          email === null
            ? eq(schema.emailContactTable.userId, input.userId)
            : or(
                eq(schema.emailContactTable.userId, input.userId),
                sql`lower(${schema.emailContactTable.email}) = ${email}`
              )
        )
      )
      .pipe(Effect.map((rows) => rows.map((row) => row.id)));

    const unsubscribed =
      contactIds.length === 0
        ? []
        : yield* db
            .update(schema.emailSubscriptionTable)
            .set({
              state: "unsubscribed",
              unsubscribedAt: input.now,
              updatedAt: input.now,
            })
            .where(
              and(
                eq(
                  schema.emailSubscriptionTable.organizationId,
                  input.organizationId
                ),
                inArray(schema.emailSubscriptionTable.contactId, contactIds),
                sql`${schema.emailSubscriptionTable.state} <> 'unsubscribed'`
              )
            )
            .returning({ id: schema.emailSubscriptionTable.id });

    return {
      subscriptions:
        removedPostSubscriptions.length +
        removedChangelogSubscriptions.length +
        unsubscribed.length,
      upvotes: removedUpvotes.length,
    };
  });

  /**
   * Deletes one person's posts and comments in one workspace.
   *
   * A comment delete cascades to its replies, so a reply by anyone else is
   * re-anchored to the nearest surviving ancestor first; only the banned
   * person's own words are removed. Posts are reverted the same way the
   * interactive delete relates to a merge: a post merged into one of theirs is
   * unmerged before the survivor disappears, so no post is left pointing at a
   * row that no longer exists.
   *
   * No timeline entries are written: a purge is one operator decision, and
   * the ban row is the audit record. The person's votes and reactions on other
   * people's posts are left alone — they are not content the person authored.
   */
  const purgeContent = Effect.fn("UserBanRepository.purgeContent")(
    function* (input: {
      readonly organizationId: string;
      readonly userId: string;
    }) {
      const comments = schema.commentTable;
      const posts = schema.postTable;
      const ownComments = and(
        eq(comments.organizationId, input.organizationId),
        eq(comments.userId, input.userId)
      );

      // Lift every reply that points at one of the person's comments onto the
      // doomed comment's parent, one level per pass, ignoring the person's own
      // replies because those are about to be deleted with their parents.
      for (let pass = 0; pass < MAX_REPLY_REANCHOR_PASSES; pass += 1) {
        const reanchored = yield* db.execute<{ id: string }>(sql`
          update ${comments} as reply
          set parent_comment_id = doomed.parent_comment_id
          from ${comments} as doomed
          where reply.parent_comment_id = doomed.id
            and doomed.organization_id = ${input.organizationId}
            and doomed.user_id = ${input.userId}
            and reply.user_id <> ${input.userId}
          returning reply.id
        `);
        if (reanchored.rows.length === 0) {
          break;
        }
      }

      // A chain longer than the bound (or one a bad write made cyclic) is
      // flattened to a thread root rather than left pointing at a comment this
      // purge is about to delete.
      yield* db.execute(sql`
        update ${comments} as reply
        set parent_comment_id = null
        from ${comments} as doomed
        where reply.parent_comment_id = doomed.id
          and doomed.organization_id = ${input.organizationId}
          and doomed.user_id = ${input.userId}
          and reply.user_id <> ${input.userId}
      `);

      const removedComments = yield* db
        .delete(comments)
        .where(ownComments)
        .returning({ id: comments.id });

      const ownPostIds = yield* db
        .select({ id: posts.id })
        .from(posts)
        .where(
          and(
            eq(posts.organizationId, input.organizationId),
            eq(posts.creatorId, input.userId)
          )
        )
        .pipe(Effect.map((rows) => rows.map((row) => row.id)));

      // A post merged into one of the person's posts becomes a standalone post
      // again; the FK-less `merged_into_post_id` would otherwise outlive its
      // target.
      if (ownPostIds.length > 0) {
        yield* db
          .update(posts)
          .set({ mergedIntoPostId: null, mergedAt: null })
          .where(
            and(
              eq(posts.organizationId, input.organizationId),
              inArray(posts.mergedIntoPostId, ownPostIds)
            )
          );
      }

      const removedPosts = yield* db
        .delete(posts)
        .where(
          and(
            eq(posts.organizationId, input.organizationId),
            eq(posts.creatorId, input.userId)
          )
        )
        .returning({ id: posts.id });

      return {
        comments: removedComments.length,
        posts: removedPosts.length,
      };
    }
  );

  /** The dashboard list; joins the account and the operator's names. */
  const list = Effect.fn("UserBanRepository.list")(function* (
    input: UserBanListRequest
  ) {
    const creator = alias(schema.userTable, "user_ban_creator");
    const search = input.search?.trim();
    const searchCondition =
      search === undefined || search === ""
        ? undefined
        : or(
            ilike(table.email, `%${escapeLikePattern(search)}%`),
            ilike(schema.userTable.name, `%${escapeLikePattern(search)}%`)
          );
    const condition = and(
      eq(table.organizationId, input.organizationId),
      searchCondition
    );

    const [items, [total]] = yield* Effect.all(
      [
        db
          .select({
            createdByMemberId: table.createdByMemberId,
            createdAt: table.createdAt,
            createdByName: creator.name,
            email: table.email,
            id: table.id,
            organizationId: table.organizationId,
            reason: table.reason,
            updatedAt: table.updatedAt,
            userId: table.userId,
            userName: schema.userTable.name,
          })
          .from(table)
          .leftJoin(schema.userTable, eq(schema.userTable.id, table.userId))
          .leftJoin(
            schema.memberTable,
            eq(schema.memberTable.id, table.createdByMemberId)
          )
          .leftJoin(creator, eq(creator.id, schema.memberTable.userId))
          .where(condition)
          .orderBy(desc(table.createdAt), asc(table.id))
          .limit(input.limit)
          .offset(input.offset),
        db
          .select({ total: count() })
          .from(table)
          .leftJoin(schema.userTable, eq(schema.userTable.id, table.userId))
          .where(condition),
      ],
      { concurrency: "unbounded" }
    );

    return { items, total: total?.total ?? 0 };
  });

  const remove = Effect.fn("UserBanRepository.remove")(function* (input: {
    readonly id: string;
    readonly organizationId: string;
  }) {
    const [removed] = yield* db
      .delete(table)
      .where(
        and(
          eq(table.id, input.id),
          eq(table.organizationId, input.organizationId)
        )
      )
      .returning({ id: table.id });
    return { removed: removed !== undefined };
  });

  /**
   * Removes the bans covering an author, named by the identities a ban can
   * store.
   *
   * The caller has a participation row rather than a ban id, so it resolved
   * the author first. Every facet is tested because a ban recorded against an
   * address carries no `user_id` and would survive an account-only delete.
   *
   * The addresses include the account's linked contacts. The author badge a
   * post row draws tests the post's contact address too, so lifting the ban
   * that badge reports has to reach an address-only row for that contact, or
   * the badge stays after a successful unban.
   */
  const removeByFacets = Effect.fn("UserBanRepository.removeByFacets")(
    function* (input: {
      readonly email: string | null;
      readonly organizationId: string;
      readonly userId: string | null;
    }) {
      const contactEmails =
        input.userId === null
          ? []
          : yield* db
              .select({ email: schema.contactTable.email })
              .from(schema.contactTable)
              .where(
                and(
                  eq(schema.contactTable.organizationId, input.organizationId),
                  eq(schema.contactTable.userId, input.userId)
                )
              )
              .pipe(
                Effect.map((rows) =>
                  rows.flatMap((row) =>
                    row.email === null ? [] : [normalizeEmailAddress(row.email)]
                  )
                )
              );
      const facets = [
        ...(input.userId === null ? [] : [eq(table.userId, input.userId)]),
        // The address the caller named is the person being unbanned, so it
        // keeps matching whether the row carries an account or not.
        ...(input.email === null ? [] : [eq(table.email, input.email)]),
        // A linked contact's address only stands for the author when the row
        // has no account of its own. Another account may be banned under the
        // same address, and lifting this author's ban must not lift that one.
        ...(contactEmails.length === 0
          ? []
          : [and(inArray(table.email, contactEmails), isNull(table.userId))]),
      ];
      if (facets.length === 0) {
        return { removed: false };
      }
      const [removed] = yield* db
        .delete(table)
        .where(
          and(eq(table.organizationId, input.organizationId), or(...facets))
        )
        .returning({ id: table.id });
      return { removed: removed !== undefined };
    }
  );

  return {
    clearVotesAndSubscriptions,
    isBanned,
    isMember,
    list,
    purgeContent,
    remove,
    removeByFacets,
    resolveTarget,
    upsert,
  };
});

export class UserBanRepository extends Context.Service<UserBanRepository>()(
  "UserBanRepository",
  { make: makeUserBanRepository }
) {
  static readonly layer = Layer.effect(this, this.make);
}
