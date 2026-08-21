import { currentDb, schema } from "@feeblo/db";
import { ContactId } from "@feeblo/id";
import { and, count, eq, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  ContactAlreadyExistsError,
  FailedToCreateContactError,
  FailedToUpdateContactError,
} from "./errors";
import type {
  TContactCreate,
  TContactDelete,
  TContactUpdate,
  TContactUpsert,
} from "./schema";

export type Contact = typeof schema.contactTable.$inferSelect;

/** Arguments for the org-scoped people-picker query backing on-behalf flows. */
export interface ContactSearchArgs {
  organizationId: string;
  query: string;
  /** Enables the alreadyVoted badge and board-aware access computation. */
  postId?: string;
  /** Result cap; defaults to 10 and is clamped to 25. */
  limit?: number;
}

const makeContactRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    create: (args: TContactCreate) =>
      Effect.gen(function* () {
        const id = args.id ?? (yield* ContactId.generate);
        const now = yield* DateTime.nowAsDate;
        const [created] = yield* db
          .insert(schema.contactTable)
          .values({
            id,
            organizationId: args.organizationId,
            externalId: args.externalId,
            email: args.email,
            name: args.name,
            phone: args.phone,
            avatar: args.avatar,
            companyId: args.companyId,
            userId: args.userId,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({
            target: [
              schema.contactTable.organizationId,
              schema.contactTable.email,
            ],
          })
          .returning();

        if (!created) {
          return yield* new ContactAlreadyExistsError({
            message: "A contact with this email already exists",
          });
        }
        return created;
      }),

    update: (args: TContactUpdate) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        const [updated] = yield* db
          .update(schema.contactTable)
          .set({
            ...(args.externalId !== undefined && {
              externalId: args.externalId,
            }),
            ...(args.email !== undefined && { email: args.email }),
            ...(args.name !== undefined && { name: args.name }),
            ...(args.phone !== undefined && { phone: args.phone }),
            ...(args.avatar !== undefined && { avatar: args.avatar }),
            ...(args.companyId !== undefined && { companyId: args.companyId }),
            ...(args.userId !== undefined && { userId: args.userId }),
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.contactTable.id, args.id),
              eq(schema.contactTable.organizationId, args.organizationId)
            )
          )
          .returning();

        return Option.fromNullishOr(updated);
      }),

    delete: (args: TContactDelete) =>
      Effect.gen(function* () {
        const [deleted] = yield* db
          .delete(schema.contactTable)
          .where(
            and(
              eq(schema.contactTable.id, args.id),
              eq(schema.contactTable.organizationId, args.organizationId)
            )
          )
          .returning({ id: schema.contactTable.id });

        return Option.fromNullishOr(deleted);
      }),

    exists: ({ id, organizationId }: TContactDelete) =>
      Effect.gen(function* () {
        const [contact] = yield* db
          .select({ id: schema.contactTable.id })
          .from(schema.contactTable)
          .where(
            and(
              eq(schema.contactTable.id, id),
              eq(schema.contactTable.organizationId, organizationId)
            )
          )
          .limit(1);
        return contact !== undefined;
      }),

    memberExistsByUserId: ({
      organizationId,
      userId,
    }: {
      organizationId: string;
      userId: string;
    }) =>
      db
        .select({ id: schema.memberTable.id })
        .from(schema.memberTable)
        .where(
          and(
            eq(schema.memberTable.organizationId, organizationId),
            eq(schema.memberTable.userId, userId)
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] !== undefined)),

    /**
     * A contact's companyId must reference a company inside the same
     * organization; without this check an authenticated member could create a
     * dangling cross-tenant reference to another org's company row.
     */
    companyExistsInOrganization: ({
      id,
      organizationId,
    }: {
      id: string;
      organizationId: string;
    }) =>
      db
        .select({ id: schema.companyTable.id })
        .from(schema.companyTable)
        .where(
          and(
            eq(schema.companyTable.id, id),
            eq(schema.companyTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] !== undefined)),

    upsertContact: (args: TContactUpsert) =>
      Effect.gen(function* () {
        if (!(args.externalId || args.email)) {
          return Option.none<typeof schema.contactTable.$inferSelect>();
        }

        const conditions = [
          eq(schema.contactTable.organizationId, args.organizationId),
        ];

        const externalId = args.externalId;
        const email = args.email;

        if (externalId && email) {
          conditions.push(
            sql`(${schema.contactTable.externalId} = ${externalId} OR ${schema.contactTable.email} = ${email})`
          );
        } else if (externalId) {
          conditions.push(
            // SAFETY: The upstream contract guarantees a string here.
            eq(schema.contactTable.externalId, externalId as string)
          );
        } else if (email) {
          // SAFETY: The upstream contract guarantees a string here.
          conditions.push(eq(schema.contactTable.email, email as string));
        }

        const existing = yield* db
          .select({ id: schema.contactTable.id })
          .from(schema.contactTable)
          .where(and(...conditions))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0]));

        if (existing) {
          const now = yield* DateTime.nowAsDate;
          const [updated = null] = yield* db
            .update(schema.contactTable)
            .set({
              ...(args.name && { name: args.name }),
              ...(args.email && { email: args.email }),
              ...(args.phone && { phone: args.phone }),
              ...(args.avatar !== undefined && { avatar: args.avatar }),
              ...(args.companyId !== undefined && {
                companyId: args.companyId,
              }),
              ...(args.userId !== undefined && { userId: args.userId }),
              updatedAt: now,
            })
            .where(eq(schema.contactTable.id, existing.id))
            .returning();
          if (!updated) {
            return yield* new FailedToUpdateContactError();
          }
          return Option.some(updated);
        }

        const id = yield* ContactId.generate;
        const now = yield* DateTime.nowAsDate;
        const [created = null] = yield* db
          .insert(schema.contactTable)
          .values({
            id,
            organizationId: args.organizationId,
            name: args.name,
            email: args.email,
            phone: args.phone,
            avatar: args.avatar ?? null,
            externalId: args.externalId,
            companyId: args.companyId,
            userId: args.userId,
            source: "WIDGET",
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!created) {
          return yield* new FailedToCreateContactError();
        }
        return Option.some(created);
      }),

    findManyContacts: (organizationId: string) =>
      db
        .select()
        .from(schema.contactTable)
        .where(eq(schema.contactTable.organizationId, organizationId)),

    /**
     * Org-scoped people-picker query backing the on-behalf author combobox.
     *
     * Matching runs over contact email/name and company name with prefix +
     * substring ILIKE patterns supported by the pg_trgm GIN indexes
     * (migration 20260821021207_pretty_morbius). Ranking is computed in SQL so
     * the whole search is one round trip: exact email hit first, then email
     * prefix, then name prefix, then any substring match.
     *
     * `hasAccess` mirrors the notification eligibility rule in
     * plan-on-behalf.md: a linked, email-verified account that is either an
     * org member, SSO-bound to this org, or an unrestricted global user. When
     * `postId` is supplied, the unrestricted-global branch additionally
     * requires that post's board to be PUBLIC.
     */
    search: (args: ContactSearchArgs) => {
      const trimmed = args.query.trim();
      if (trimmed.length < 2) {
        return Effect.succeed([]);
      }

      const limit = Math.min(Math.max(args.limit ?? 10, 1), 25);
      // Escape LIKE metacharacters so user input can't inject wildcards.
      const escaped = trimmed.replace(/[\\%_]/g, "\\$&");
      const exactEmail = escaped.toLowerCase();
      const prefix = `${escaped}%`;
      const substring = `%${escaped}%`;

      const rankCase = sql`CASE
        WHEN lower(${schema.contactTable.email}) = ${exactEmail} THEN 0
        WHEN ${schema.contactTable.email} ILIKE ${prefix} ESCAPE '\\' THEN 1
        WHEN ${schema.contactTable.name} ILIKE ${prefix} ESCAPE '\\' THEN 2
        ELSE 3
      END`;

      // SAFETY: literal table names in the EXISTS probes are the stable
      // snake_case names of post/board/upvote; ids are bound parameters.
      const publicBoardProbe = sql`EXISTS (
        SELECT 1 FROM "post" p
        JOIN "board" b ON b.id = p.board_id
        WHERE p.id = ${args.postId}
          AND p.organization_id = ${args.organizationId}
          AND b.visibility = 'PUBLIC'
      )`;

      const unrestrictedGlobal = args.postId !== undefined
        ? sql`(
            ${schema.userTable.restrictedToOrganizationId} IS NULL
            AND ${publicBoardProbe}
          )`
        : sql`${schema.userTable.restrictedToOrganizationId} IS NULL`;

      // COALESCE guards against SQL three-valued logic: when every branch of
      // the inner OR evaluates to NULL (e.g. an unrestricted user compared
      // against a non-null organization id), the AND chain would otherwise
      // yield NULL instead of FALSE.
      const hasAccess = sql<boolean>`COALESCE(
        (
          ${schema.userTable.id} IS NOT NULL
          AND ${schema.userTable.emailVerified} IS TRUE
          AND (
            ${schema.memberTable.id} IS NOT NULL
            OR ${schema.userTable.restrictedToOrganizationId} = ${args.organizationId}
            OR ${unrestrictedGlobal}
          )
        ),
        FALSE
      )`;

      const alreadyVoted = args.postId !== undefined
        ? sql<boolean>`EXISTS (
            SELECT 1 FROM "upvote" uv
            WHERE uv.post_id = ${args.postId}
              AND uv.organization_id = ${args.organizationId}
              AND uv.user_id = ${schema.contactTable.userId}
          )`
        : sql<boolean>`FALSE`;

      return db
        .select({
          contactId: schema.contactTable.id,
          userId: schema.contactTable.userId,
          name: schema.contactTable.name,
          email: schema.contactTable.email,
          avatarUrl: schema.contactTable.avatar,
          companyName: schema.companyTable.name,
          isMember: sql<boolean>`${schema.memberTable.id} IS NOT NULL`,
          hasAccess,
          alreadyVoted,
        })
        .from(schema.contactTable)
        .leftJoin(
          schema.companyTable,
          eq(schema.companyTable.id, schema.contactTable.companyId)
        )
        .leftJoin(
          schema.memberTable,
          and(
            eq(
              schema.memberTable.organizationId,
              schema.contactTable.organizationId
            ),
            eq(schema.memberTable.userId, schema.contactTable.userId)
          )
        )
        .leftJoin(
          schema.userTable,
          eq(schema.userTable.id, schema.contactTable.userId)
        )
        .where(
          and(
            eq(
              schema.contactTable.organizationId,
              args.organizationId
            ),
            sql`(
              ${schema.contactTable.email} ILIKE ${substring} ESCAPE '\\'
              OR ${schema.contactTable.name} ILIKE ${substring} ESCAPE '\\'
              OR COALESCE(${schema.companyTable.name}, '') ILIKE ${substring} ESCAPE '\\'
            )`
          )
        )
        .orderBy(rankCase, schema.contactTable.createdAt)
        .limit(limit);
    },

    countByOrganizationId: (organizationId: string) =>
      db
        .select({ count: count() })
        .from(schema.contactTable)
        .where(eq(schema.contactTable.organizationId, organizationId))
        .pipe(Effect.map((rows) => Number(rows[0]?.count ?? 0))),
  };
});

export class ContactRepository extends Context.Service<ContactRepository>()(
  "ContactRepository",
  {
    make: makeContactRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
