import { currentDb, Database, schema } from "@feeblo/db";
import type { TEntitySource } from "@feeblo/domain-contracts/entity-source";
import { CompanyId } from "@feeblo/id";
import { and, count, desc, eq, ne, sql } from "drizzle-orm";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  CompanyAlreadyExistsError,
  FailedToCreateCompanyError,
  FailedToUpdateCompanyError,
} from "./errors";
import type { TCompanyUpsert } from "./schema";

/**
 * The write inputs, typed with plain identifiers rather than the RPC payload
 * schemas' branded ones.
 *
 * The dashboard decodes a branded id before it reaches the repository; the
 * Public API's key is scoped to one workspace and its ids come from the
 * database, so it passes strings. Widening the parameter to `string` keeps one
 * repository serving both without a decode that proves nothing the request did
 * not already establish.
 */
interface TCompanyCreateInput {
  id?: string | undefined;
  organizationId: string;
  externalId?: string | null | undefined;
  name: string;
  avatar?: string | null | undefined;
  externalCreatedAt?: Date | null | undefined;
}

interface TCompanyUpdateInput {
  id: string;
  organizationId: string;
  externalId?: string | null | undefined;
  name?: string | undefined;
  avatar?: string | null | undefined;
  externalCreatedAt?: Date | null | undefined;
}

interface TCompanyDeleteInput {
  id: string;
  organizationId: string;
}

export type Company = typeof schema.companyTable.$inferSelect;

/**
 * The fields a company read selects, and the only place a company field is
 * named.
 *
 * Shared by the dashboard's list and the Public API's paged reads; the public
 * response mapper narrows this to the published field set, so the workspace id
 * cannot reach a payload.
 */
const COMPANY_FIELDS = {
  id: schema.companyTable.id,
  organizationId: schema.companyTable.organizationId,
  name: schema.companyTable.name,
  externalId: schema.companyTable.externalId,
  avatar: schema.companyTable.avatar,
  externalCreatedAt: schema.companyTable.externalCreatedAt,
  source: schema.companyTable.source,
  createdAt: schema.companyTable.createdAt,
  updatedAt: schema.companyTable.updatedAt,
} as const;

interface TCompanyFindPage {
  after: { readonly createdAt: Date; readonly id: string } | null;
  limit: number;
  organizationId: string;
}

const makeCompanyRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    create: (
      args: TCompanyCreateInput,
      options?: { readonly source?: TEntitySource }
    ) =>
      Effect.gen(function* () {
        const id = args.id ?? (yield* CompanyId.generate);
        const now = yield* DateTime.nowAsDate;
        const [created] = yield* db
          .insert(schema.companyTable)
          .values({
            id,
            organizationId: args.organizationId,
            name: args.name,
            externalId: args.externalId,
            avatar: args.avatar,
            externalCreatedAt: args.externalCreatedAt,
            // Omitted rather than defaulted here: the table's own default is
            // the dashboard's provenance, and the Public API names `API`.
            ...(options?.source !== undefined && { source: options.source }),
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({
            target: [
              schema.companyTable.organizationId,
              schema.companyTable.name,
            ],
          })
          .returning();

        if (!created) {
          return yield* new CompanyAlreadyExistsError({
            message: "A company with this name already exists",
          });
        }
        return created;
      }),

    update: (args: TCompanyUpdateInput) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        const [updated] = yield* db
          .update(schema.companyTable)
          .set({
            ...(args.name !== undefined && { name: args.name }),
            ...(args.externalId !== undefined && {
              externalId: args.externalId,
            }),
            ...(args.avatar !== undefined && { avatar: args.avatar }),
            ...(args.externalCreatedAt !== undefined && {
              externalCreatedAt: args.externalCreatedAt,
            }),
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.companyTable.id, args.id),
              eq(schema.companyTable.organizationId, args.organizationId)
            )
          )
          .returning();

        return Option.fromNullishOr(updated);
      }),

    delete: (args: TCompanyDeleteInput) =>
      Effect.gen(function* () {
        const [deleted] = yield* db
          .delete(schema.companyTable)
          .where(
            and(
              eq(schema.companyTable.id, args.id),
              eq(schema.companyTable.organizationId, args.organizationId)
            )
          )
          .returning({ id: schema.companyTable.id });

        return Option.fromNullishOr(deleted);
      }),

    exists: ({ id, organizationId }: TCompanyDeleteInput) =>
      Effect.gen(function* () {
        const [company] = yield* db
          .select({ id: schema.companyTable.id })
          .from(schema.companyTable)
          .where(
            and(
              eq(schema.companyTable.id, id),
              eq(schema.companyTable.organizationId, organizationId)
            )
          )
          .limit(1);
        return company !== undefined;
      }),

    upsertCompany: (args: TCompanyUpsert) =>
      Effect.gen(function* () {
        /**
         * The match is deterministic, not an `OR`: the external id wins when
         * the caller supplies one — it is the sync's own identity for the
         * company — and the name match is the fallback. Both keys matching
         * different rows is refused below rather than guessed at, because
         * updating either row would re-write a key the other holds (a unique
         * violation with no recovery inside this upsert).
         */
        const findByKey = (): Effect.Effect<
          typeof schema.companyTable.$inferSelect | undefined,
          EffectDrizzleQueryError,
          Database.Database
        > =>
          Effect.gen(function* () {
            if (args.externalId) {
              const [byExternalId] = yield* db
                .select()
                .from(schema.companyTable)
                .where(
                  and(
                    eq(schema.companyTable.organizationId, args.organizationId),
                    eq(schema.companyTable.externalId, args.externalId)
                  )
                )
                .limit(1);
              if (byExternalId !== undefined) {
                return byExternalId;
              }
            }
            const [byName] = yield* db
              .select()
              .from(schema.companyTable)
              .where(
                and(
                  eq(schema.companyTable.organizationId, args.organizationId),
                  eq(schema.companyTable.name, args.name)
                )
              )
              .limit(1);
            return byName;
          });

        const existing = yield* findByKey();

        if (existing) {
          // A foreign external id held by a different row is the ambiguous
          // state above: refuse rather than write a key collision.
          if (
            args.externalId !== undefined &&
            existing.externalId !== null &&
            existing.externalId !== args.externalId
          ) {
            const [other] = yield* db
              .select({ id: schema.companyTable.id })
              .from(schema.companyTable)
              .where(
                and(
                  eq(schema.companyTable.organizationId, args.organizationId),
                  eq(schema.companyTable.externalId, args.externalId)
                )
              )
              .limit(1);
            if (other !== undefined && other.id !== existing.id) {
              return yield* new FailedToUpdateCompanyError();
            }
          }

          const now = yield* DateTime.nowAsDate;
          const [updated = null] = yield* db
            .update(schema.companyTable)
            .set({
              ...(args.externalId && { externalId: args.externalId }),
              ...(args.avatar !== undefined && { avatar: args.avatar }),
              ...(args.externalCreatedAt !== undefined && {
                externalCreatedAt: args.externalCreatedAt,
              }),
              updatedAt: now,
            })
            .where(eq(schema.companyTable.id, existing.id))
            .returning();
          if (!updated) {
            return yield* new FailedToUpdateCompanyError();
          }
          return updated;
        }

        const id = yield* CompanyId.generate;
        const now = yield* DateTime.nowAsDate;
        const [created = null] = yield* db
          .insert(schema.companyTable)
          .values({
            id,
            organizationId: args.organizationId,
            name: args.name,
            externalId: args.externalId,
            avatar: args.avatar ?? null,
            externalCreatedAt: args.externalCreatedAt ?? null,
            source: "WIDGET",
            createdAt: now,
            updatedAt: now,
          })
          // A concurrent SSO login for the same company loses the unique
          // (organization, name) or (organization, external id) race here;
          // the winner is re-read through the same lookup rather than a
          // unique violation failing the caller's transaction.
          .onConflictDoNothing()
          .returning();
        if (created) {
          return created;
        }
        const winner = yield* findByKey();
        if (winner) {
          return winner;
        }
        return yield* new FailedToCreateCompanyError();
      }),

    findManyCompanies: (organizationId: string) =>
      db
        .select(COMPANY_FIELDS)
        .from(schema.companyTable)
        .where(eq(schema.companyTable.organizationId, organizationId)),

    /**
     * One page of the workspace's companies, newest first.
     *
     * The same `(createdAt, id)` tuple the Public API's other lists page on,
     * and one row more than asked for so the caller learns whether another
     * page exists without a second query.
     */
    findPage: ({ after, limit, organizationId }: TCompanyFindPage) => {
      const conditions = [
        eq(schema.companyTable.organizationId, organizationId),
        ...(after === null
          ? []
          : [
              sql`(${schema.companyTable.createdAt}, ${schema.companyTable.id}) < (${after.createdAt}, ${after.id})`,
            ]),
      ];

      return db
        .select(COMPANY_FIELDS)
        .from(schema.companyTable)
        .where(and(...conditions))
        .orderBy(
          desc(schema.companyTable.createdAt),
          desc(schema.companyTable.id)
        )
        .limit(limit + 1);
    },

    /** One company of the calling workspace, or nothing. */
    findById: ({
      id,
      organizationId,
    }: {
      id: string;
      organizationId: string;
    }) =>
      db
        .select(COMPANY_FIELDS)
        .from(schema.companyTable)
        .where(
          and(
            eq(schema.companyTable.id, id),
            eq(schema.companyTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => Option.fromNullishOr(rows[0]))),

    countByOrganizationId: (organizationId: string) =>
      db
        .select({ count: count() })
        .from(schema.companyTable)
        .where(eq(schema.companyTable.organizationId, organizationId))
        .pipe(Effect.map((rows) => rows[0]?.count ?? 0)),

    /**
     * The company that already holds this name, if any.
     *
     * `company_organizationId_name_uidx` is the authority; this is the courtesy
     * check that lets an ordinary duplicate be answered with a message about
     * the name instead of a driver error the caller cannot act on.
     */
    findNameConflict: ({
      excludeCompanyId,
      name,
      organizationId,
    }: {
      excludeCompanyId: string | null;
      name: string;
      organizationId: string;
    }) =>
      db
        .select({ id: schema.companyTable.id })
        .from(schema.companyTable)
        .where(
          and(
            eq(schema.companyTable.organizationId, organizationId),
            eq(schema.companyTable.name, name),
            ...(excludeCompanyId === null
              ? []
              : [ne(schema.companyTable.id, excludeCompanyId)])
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => Option.fromNullishOr(rows[0]))),

    /**
     * The company that already holds this external id, if any.
     *
     * Looked up separately from the name so a caller can say which field
     * collided: `externalId` is the caller's own identifier, and being told
     * that a *name* is taken when the caller reused a sync key would send them
     * looking in the wrong place. Postgres treats `NULL` as distinct in a
     * unique index, so an unset external id never conflicts with another unset
     * one and is never passed here.
     */
    findExternalIdConflict: ({
      excludeCompanyId,
      externalId,
      organizationId,
    }: {
      excludeCompanyId: string | null;
      externalId: string;
      organizationId: string;
    }) =>
      db
        .select({ id: schema.companyTable.id })
        .from(schema.companyTable)
        .where(
          and(
            eq(schema.companyTable.organizationId, organizationId),
            eq(schema.companyTable.externalId, externalId),
            ...(excludeCompanyId === null
              ? []
              : [ne(schema.companyTable.id, excludeCompanyId)])
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => Option.fromNullishOr(rows[0]))),

    /**
     * How many CRM entries the workspace holds, for the plan's entry limit.
     *
     * Counts companies and contacts together, and selects nothing: the Public
     * API does not return contacts, but the plan limit that gates creating a
     * company counts them, and the dashboard's own create is gated on the same
     * number. Two queries rather than one union, because each then uses its own
     * `organizationId` index.
     *
     * Only meaningful inside the write transaction that holds the workspace
     * lock: read anywhere else, the number it returns can be stale by the time
     * the row it authorizes is inserted.
     */
    countCrmEntries: (organizationId: string) =>
      Effect.gen(function* () {
        const [companyRows, contactRows] = yield* Effect.all([
          db
            .select({ total: count(schema.companyTable.id) })
            .from(schema.companyTable)
            .where(eq(schema.companyTable.organizationId, organizationId)),
          db
            .select({ total: count(schema.contactTable.id) })
            .from(schema.contactTable)
            .where(eq(schema.contactTable.organizationId, organizationId)),
        ]);

        return (
          (companyRows.at(0)?.total ?? 0) + (contactRows.at(0)?.total ?? 0)
        );
      }),
  };
});

export class CompanyRepository extends Context.Service<CompanyRepository>()(
  "CompanyRepository",
  { make: makeCompanyRepository }
) {
  static readonly layer = Layer.effect(this, this.make);
}

/**
 * Reads the repository from the fiber context.
 *
 * `HttpApiBuilder` does not thread a handler's service requirements through the
 * route layer, so the Public API's operations take it from the context the
 * composition provides — the same shape as `currentCommentService`.
 */
export const currentCompanyRepository = Effect.context<never>().pipe(
  Effect.map((context) => Context.getUnsafe(context, CompanyRepository))
);
