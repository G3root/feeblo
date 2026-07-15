import { currentDb, schema } from "@feeblo/db";
import { CompanyAttributeValueId, CompanyId } from "@feeblo/id";
import { and, eq, or } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { buildAttributeValueColumns } from "../contact/utils";
import type {
  TCompanyAttributeDefinitionCreate,
  TCompanyAttributeValueUpsert,
  TCompanyUpsert,
} from "./schema";

export type Company = typeof schema.companyTable.$inferSelect;

const makeCompanyRepository = Effect.succeed({
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

  findCompanyAttributeDefinitions: (organizationId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      return yield* db
        .select()
        .from(schema.companyAttributeDefinitionTable)
        .where(
          eq(
            schema.companyAttributeDefinitionTable.organizationId,
            organizationId
          )
        );
    }),

  createCompanyAttributeDefinition: (args: TCompanyAttributeDefinitionCreate) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.companyAttributeDefinitionTable).values({
        ...args,
        description: args.description ?? null,
        config: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }),

  findCompanyAttributeValues: (companyId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      return yield* db
        .select()
        .from(schema.companyAttributeValueTable)
        .where(eq(schema.companyAttributeValueTable.companyId, companyId));
    }),

  upsertCompanyAttributeValue: (args: TCompanyAttributeValueUpsert) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const valueMap = buildAttributeValueColumns(args.value);

      if (args.id) {
        const [updated = null] = yield* db
          .update(schema.companyAttributeValueTable)
          .set({ ...valueMap, updatedAt: new Date() })
          .where(eq(schema.companyAttributeValueTable.id, args.id))
          .returning();
        if (!updated) {
          return yield* Effect.die(
            new Error("Company attribute value update did not return a row")
          );
        }
        return updated;
      }

      const id = yield* CompanyAttributeValueId.generate;
      const now = new Date();
      const [created = null] = yield* db
        .insert(schema.companyAttributeValueTable)
        .values({
          id,
          companyId: args.companyId,
          attributeId: args.attributeId,
          ...valueMap,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) {
        return yield* Effect.die(
          new Error("Company attribute value insert did not return a row")
        );
      }
      return created;
    }),
});

/** @effect-expect-leaking Database */
export class CompanyRepository extends Context.Service<CompanyRepository>()(
  "CompanyRepository",
  { make: makeCompanyRepository }
) {
  static readonly layer = Layer.effect(this, this.make);
}
