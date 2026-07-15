import { currentDb, schema } from "@feeblo/db";
import { CompanyId } from "@feeblo/id";
import { and, eq, or } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type {
  TCompanyCreate,
  TCompanyDelete,
  TCompanyUpdate,
  TCompanyUpsert,
} from "./schema";

export type Company = typeof schema.companyTable.$inferSelect;

const makeCompanyRepository = Effect.succeed({
  create: (args: TCompanyCreate) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const id = yield* CompanyId.generate;
      const now = new Date();
      const [created] = yield* db
        .insert(schema.companyTable)
        .values({
          id,
          organizationId: args.organizationId,
          name: args.name,
          externalId: args.externalId,
          avatar: args.avatar,
          externalCreatedAt: args.externalCreatedAt,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!created) {
        return yield* Effect.die(
          new Error("Company insert did not return a row")
        );
      }
      return created;
    }),

  update: (args: TCompanyUpdate) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
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
          updatedAt: new Date(),
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

  delete: (args: TCompanyDelete) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
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

  exists: ({ id, organizationId }: TCompanyDelete) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
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
      const db = yield* currentDb;
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
        const [updated = null] = yield* db
          .update(schema.companyTable)
          .set({
            ...(args.externalId && { externalId: args.externalId }),
            ...(args.avatar !== undefined && { avatar: args.avatar }),
            ...(args.externalCreatedAt !== undefined && {
              externalCreatedAt: args.externalCreatedAt,
            }),
            updatedAt: new Date(),
          })
          .where(eq(schema.companyTable.id, existing.id))
          .returning();
        if (!updated) {
          return yield* Effect.die(
            new Error("Company update did not return a row")
          );
        }
        return updated;
      }

      const id = yield* CompanyId.generate;
      const now = new Date();
      const [created = null] = yield* db
        .insert(schema.companyTable)
        .values({
          id,
          organizationId: args.organizationId,
          name: args.name,
          externalId: args.externalId,
          avatar: args.avatar ?? null,
          externalCreatedAt: args.externalCreatedAt ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) {
        return yield* Effect.die(
          new Error("Company insert did not return a row")
        );
      }
      return created;
    }),

  findManyCompanies: (organizationId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      return yield* db
        .select()
        .from(schema.companyTable)
        .where(eq(schema.companyTable.organizationId, organizationId));
    }),
});

/** @effect-expect-leaking Database */
export class CompanyRepository extends Context.Service<CompanyRepository>()(
  "CompanyRepository",
  { make: makeCompanyRepository }
) {
  static readonly layer = Layer.effect(this, this.make);
}
