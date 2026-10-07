import { currentDb, schema } from "@feeblo/db";
import type { TEntitySource } from "@feeblo/domain-contracts/entity-source";
import { CompanyId } from "@feeblo/id";
import { and, count, desc, eq, ne, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  CompanyAlreadyExistsError,
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

    /**
     * The row an SSO upsert's keys name, or `None`.
     *
     * Deterministic, not an `OR`: the external id wins when the caller
     * supplies one — it is the sync's own identity for the company — and the
     * name match is the fallback. Split from the upsert so the SSO path's
     * find-or-create can run the lookup after the workspace lock and again
     * after a lost insert race (`ensureCrmEntry`).
     */
    findUpsertCompany: (args: TCompanyUpsert) =>
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
            return Option.some(byExternalId);
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
        return Option.fromNullishOr(byName);
      }),

    /**
     * Applies an SSO upsert to the row its keys matched.
     *
     * A foreign external id held by a different row is the ambiguous state
     * the lookup cannot resolve: writing over another row's key is a unique
     * violation with no recovery inside this update, so that state is refused
     * deterministically rather than guessed at. The row may have been matched
     * by name and hold `null` here, so the probe runs whenever the update
     * would write a different value, over null included.
     */
    updateUpsertCompany: (
      args: TCompanyUpsert & {
        readonly existing: typeof schema.companyTable.$inferSelect;
      }
    ) =>
      Effect.gen(function* () {
        const { existing } = args;
        if (args.externalId && existing.externalId !== args.externalId) {
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
      }),

    /**
     * Inserts a new SSO company, tolerating a lost unique-key race.
     *
     * `None` means a concurrent sign-in wrote the row first; the SSO path
     * re-reads through `findUpsertCompany` rather than failing the caller's
     * transaction, and a win reported by neither lookup is the caller's
     * unrecoverable-race failure.
     */
    insertUpsertCompany: (args: TCompanyUpsert) =>
      Effect.gen(function* () {
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
          .onConflictDoNothing()
          .returning();
        return Option.fromNullishOr(created);
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
  };
});

export class CompanyRepository extends Context.Service<CompanyRepository>()(
  "CompanyRepository",
  { make: makeCompanyRepository }
) {
  static readonly layer = Layer.effect(this, this.make);
}
