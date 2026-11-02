import { currentDb, schema, transaction } from "@feeblo/db";
import { normalizeEmailAddress } from "@feeblo/db/validation-schema/email";
import { UserBlockId } from "@feeblo/id";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { UserBlockDataError } from "./errors";
import type { UserBlockListRequest, UserBlockTarget } from "./schema";
import { normalizeBlockEmail } from "./schema";

const table = schema.userBlockTable;

/** A stored block, before the display names the list joins in. */
export type UserBlockStoredRow = {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string | null;
  readonly email: string | null;
  readonly reason: string | null;
  readonly createdByMemberId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

/** A stored block plus the display names the dashboard's list joins in. */
export type UserBlockRow = UserBlockStoredRow & {
  readonly userName: string | null;
  readonly createdByName: string | null;
};

/** The identity a block check is performed against. */
export type UserBlockLookup = {
  readonly organizationId: string;
  readonly userId?: string | null;
  readonly email?: string | null;
  /** Resolved to the contact's account and address before the check. */
  readonly contactId?: string | null;
};

/**
 * The result of resolving an operator's target to the keys a block stores.
 *
 * `member` is separate from `not_found`: a workspace member is a real user, but
 * blocking them is the wrong tool — membership removal is. `unresolvable` is a
 * contact with neither an account nor an address, which the operator has to fix
 * in the CRM first.
 */
export type ResolvedBlockTarget =
  | {
      readonly status: "ok";
      readonly userId: string | null;
      readonly email: string | null;
      readonly name: string | null;
    }
  | { readonly status: "not_found" }
  | { readonly status: "member" }
  | { readonly status: "unresolvable" };

export type UpsertUserBlockInput = {
  readonly organizationId: string;
  readonly userId: string | null;
  readonly email: string | null;
  readonly reason: string | null;
  readonly createdByMemberId: string | null;
  readonly now: Date;
};

const dataError = (operation: string, reason: string): UserBlockDataError =>
  new UserBlockDataError({ operation, reason });

const escapeLikePattern = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

const normalizedEmail = (email: string | null | undefined): string | null =>
  email === null || email === undefined ? null : normalizeEmailAddress(email);

const makeUserBlockRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  const isMember = (input: {
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

  /**
   * Whether this identity is blocked in this workspace.
   *
   * A missing identity is never blocked: an anonymous widget submission has
   * nobody to check. The predicate is an OR over the two facets, so a block by
   * address still applies to an account created after it.
   */
  const isBlocked = Effect.fn("UserBlockRepository.isBlocked")(function* (
    input: UserBlockLookup
  ) {
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
   * Resolves the operator's target to the account and address a block stores.
   *
   * A contact is a CRM row and may not have an account (or an address); the
   * repository reports that rather than writing a block with no subject. A
   * user who is a member of the workspace is rejected because membership
   * removal is the correct operation for staff.
   */
  const resolveTarget = Effect.fn("UserBlockRepository.resolveTarget")(
    function* (input: {
      readonly organizationId: string;
      readonly target: UserBlockTarget;
    }) {
      const target = input.target;
      if (target._tag === "email") {
        const email = normalizeBlockEmail(target.email);

        // A workspace contact is the strongest relationship the address can
        // have: it is already the workspace's record of this person. A
        // contact with no linked account never adopts a same-address global
        // account — the block stays address-scoped and does not reach an
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
          .limit(1);
        if (contact !== undefined) {
          if (contact.userId === null) {
            return {
              email,
              name: contact.name,
              status: "ok",
              userId: null,
            } as const;
          }
          const member = yield* isMember({
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

        // No contact: an account may still be blocked by address if it is
        // related to this workspace through a restricted identity or a
        // membership. An unrelated global account is not adopted by address.
        const [user] = yield* db
          .select({
            id: schema.userTable.id,
            name: schema.userTable.name,
            restrictedToOrganizationId:
              schema.userTable.restrictedToOrganizationId,
          })
          .from(schema.userTable)
          .where(sql`lower(${schema.userTable.email}) = ${email}`)
          .limit(1);
        if (user !== undefined) {
          const member = yield* isMember({
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
        const [user] = yield* db
          .select({
            email: schema.userTable.email,
            id: schema.userTable.id,
            name: schema.userTable.name,
            restrictedToOrganizationId:
              schema.userTable.restrictedToOrganizationId,
          })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.userId))
          .limit(1);
        if (user === undefined) {
          return { status: "not_found" } as const;
        }
        const member = yield* isMember({
          organizationId: input.organizationId,
          userId: user.id,
        });
        if (member) {
          return { status: "member" } as const;
        }

        // A user id is only addressable from this workspace when the account
        // is related to it: a restricted portal identity, a membership, or a
        // contact row. An unrelated account is reported as not found rather
        // than revealing its name and address to this tenant.
        const contact = yield* findContactByUserId({
          organizationId: input.organizationId,
          userId: user.id,
        });
        const related =
          user.restrictedToOrganizationId === input.organizationId ||
          contact !== undefined;
        if (!related) {
          return { status: "not_found" } as const;
        }

        return {
          email: normalizedEmail(user.email),
          name: contact?.name ?? user.name,
          status: "ok",
          userId: user.id,
        } as const;
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
          const member = yield* isMember({
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
   * Writes one block, merging the account and address facets onto one row.
   *
   * The insert is the common path. A conflict means another facet of the same
   * person is already blocked; the transaction then deletes the duplicate rows
   * before filling the missing facet on the survivor, so both unique indexes
   * stay satisfied. The whole thing is database work, so the transaction
   * retry (ADR 0020) can replay it.
   */
  const upsert = Effect.fn("UserBlockRepository.upsert")(function* (
    input: UpsertUserBlockInput
  ) {
    const email = normalizedEmail(input.email);
    if (input.userId === null && email === null) {
      return yield* dataError(
        "upsert",
        "A block needs an account or an email address"
      );
    }

    return yield* transaction(
      Effect.gen(function* () {
        const [inserted] = yield* db
          .insert(table)
          .values({
            id: yield* UserBlockId.generate,
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
            "A block conflict did not resolve to a stored row"
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
            email: keeper.email ?? email,
            reason: input.reason ?? keeper.reason,
            updatedAt: input.now,
            userId: keeper.userId ?? input.userId,
          })
          .where(eq(table.id, keeper.id))
          .returning();
        if (updated === undefined) {
          return yield* dataError(
            "upsert",
            "A block update did not resolve to a stored row"
          );
        }
        return updated;
      })
    );
  });

  /** The dashboard list; joins the account and the operator's names. */
  const list = Effect.fn("UserBlockRepository.list")(function* (
    input: UserBlockListRequest
  ) {
    const creator = alias(schema.userTable, "user_block_creator");
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

  const remove = Effect.fn("UserBlockRepository.remove")(function* (input: {
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

  return { isBlocked, list, remove, resolveTarget, upsert };
});

export class UserBlockRepository extends Context.Service<UserBlockRepository>()(
  "UserBlockRepository",
  { make: makeUserBlockRepository }
) {
  static readonly layer = Layer.effect(this, this.make);
}
