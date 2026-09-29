import { currentDb, schema } from "@feeblo/db";
import type { TEntitySource } from "@feeblo/domain-contracts/entity-source";
import { CompanyId } from "@feeblo/id";
import { and, count, desc, eq, or, sql } from "drizzle-orm";
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
        const existing = yield* db
          .select({ id: schema.companyTable.id })
          .from(schema.companyTable)
          .where(
            and(
              eq(schema.companyTable.organizationId, args.organizationId),
              args.externalId
                ? or(
                    eq(schema.companyTable.name, args.name),
                    eq(schema.companyTable.externalId, args.externalId)
                  )
                : eq(schema.companyTable.name, args.name)
            )
          )
          .limit(1)
          .pipe(Effect.map((rows) => rows[0]));

        if (existing) {
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
          .returning();
        if (!created) {
          return yield* new FailedToCreateCompanyError();
        }
        return created;
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
  };
});

export class CompanyRepository extends Context.Service<CompanyRepository>()(
  "CompanyRepository",
  { make: makeCompanyRepository }
) {
  static readonly layer = Layer.effect(this, this.make);
}
