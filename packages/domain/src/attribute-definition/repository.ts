import { currentDb, schema } from "@feeblo/db";
import { CompanyAttributeValueId, ContactAttributeValueId } from "@feeblo/id";
import { and, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { buildAttributeValueColumns } from "../contact/utils";
import type {
  TCompanyAttributeDefinitionCreate,
  TCompanyAttributeDefinitionDelete,
  TCompanyAttributeDefinitionUpdate,
  TCompanyAttributeValueUpsert,
  TContactAttributeDefinitionCreate,
  TContactAttributeDefinitionDelete,
  TContactAttributeDefinitionUpdate,
  TContactAttributeValueUpsert,
} from "./schema";

const makeAttributeDefinitionRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    findContactAttributeDefinitions: (organizationId: string) =>
      db
        .select()
        .from(schema.contactAttributeDefinitionTable)
        .where(
          eq(
            schema.contactAttributeDefinitionTable.organizationId,
            organizationId
          )
        ),

    createContactAttributeDefinition: (
      args: TContactAttributeDefinitionCreate
    ) =>
      db
        .insert(schema.contactAttributeDefinitionTable)
        .values({
          ...args,
          description: args.description ?? null,
          config: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .pipe(Effect.asVoid),

    updateContactAttributeDefinition: (
      args: TContactAttributeDefinitionUpdate
    ) =>
      db
        .update(schema.contactAttributeDefinitionTable)
        .set({
          name: args.name,
          key: args.key,
          description: args.description,
          type: args.type,
          isRequired: args.isRequired,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.contactAttributeDefinitionTable.id, args.id),
            eq(
              schema.contactAttributeDefinitionTable.organizationId,
              args.organizationId
            )
          )
        )
        .pipe(Effect.asVoid),

    deleteContactAttributeDefinition: (
      args: TContactAttributeDefinitionDelete
    ) =>
      db
        .delete(schema.contactAttributeDefinitionTable)
        .where(
          and(
            eq(schema.contactAttributeDefinitionTable.id, args.id),
            eq(
              schema.contactAttributeDefinitionTable.organizationId,
              args.organizationId
            )
          )
        )
        .pipe(Effect.asVoid),

    contactAttributeDefinitionExists: (
      args: TContactAttributeDefinitionDelete
    ) =>
      db
        .select({ id: schema.contactAttributeDefinitionTable.id })
        .from(schema.contactAttributeDefinitionTable)
        .where(
          and(
            eq(schema.contactAttributeDefinitionTable.id, args.id),
            eq(
              schema.contactAttributeDefinitionTable.organizationId,
              args.organizationId
            )
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] !== undefined)),

    findCompanyAttributeDefinitions: (organizationId: string) =>
      db
        .select()
        .from(schema.companyAttributeDefinitionTable)
        .where(
          eq(
            schema.companyAttributeDefinitionTable.organizationId,
            organizationId
          )
        ),

    createCompanyAttributeDefinition: (
      args: TCompanyAttributeDefinitionCreate
    ) =>
      db
        .insert(schema.companyAttributeDefinitionTable)
        .values({
          ...args,
          description: args.description ?? null,
          config: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .pipe(Effect.asVoid),

    updateCompanyAttributeDefinition: (
      args: TCompanyAttributeDefinitionUpdate
    ) =>
      db
        .update(schema.companyAttributeDefinitionTable)
        .set({
          name: args.name,
          key: args.key,
          description: args.description,
          type: args.type,
          isRequired: args.isRequired,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.companyAttributeDefinitionTable.id, args.id),
            eq(
              schema.companyAttributeDefinitionTable.organizationId,
              args.organizationId
            )
          )
        )
        .pipe(Effect.asVoid),

    deleteCompanyAttributeDefinition: (
      args: TCompanyAttributeDefinitionDelete
    ) =>
      db
        .delete(schema.companyAttributeDefinitionTable)
        .where(
          and(
            eq(schema.companyAttributeDefinitionTable.id, args.id),
            eq(
              schema.companyAttributeDefinitionTable.organizationId,
              args.organizationId
            )
          )
        )
        .pipe(Effect.asVoid),

    companyAttributeDefinitionExists: (
      args: TCompanyAttributeDefinitionDelete
    ) =>
      db
        .select({ id: schema.companyAttributeDefinitionTable.id })
        .from(schema.companyAttributeDefinitionTable)
        .where(
          and(
            eq(schema.companyAttributeDefinitionTable.id, args.id),
            eq(
              schema.companyAttributeDefinitionTable.organizationId,
              args.organizationId
            )
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] !== undefined)),

    findContactAttributeValues: (contactId: string) =>
      db
        .select()
        .from(schema.contactAttributeValueTable)
        .where(eq(schema.contactAttributeValueTable.contactId, contactId)),

    contactExists: (contactId: string, organizationId: string) =>
      db
        .select({ id: schema.contactTable.id })
        .from(schema.contactTable)
        .where(
          and(
            eq(schema.contactTable.id, contactId),
            eq(schema.contactTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] !== undefined)),

    upsertContactAttributeValue: (args: TContactAttributeValueUpsert) =>
      Effect.gen(function* () {
        const valueMap = buildAttributeValueColumns(args.value);

        if (args.id) {
          const [updated] = yield* db
            .update(schema.contactAttributeValueTable)
            .set({ ...valueMap, updatedAt: new Date() })
            .where(
              and(
                eq(schema.contactAttributeValueTable.id, args.id),
                eq(schema.contactAttributeValueTable.contactId, args.contactId)
              )
            )
            .returning();

          if (updated) {
            return updated;
          }
        }

        const id = args.id ?? (yield* ContactAttributeValueId.generate);
        const now = new Date();
        const [created = null] = yield* db
          .insert(schema.contactAttributeValueTable)
          .values({
            id,
            contactId: args.contactId,
            attributeId: args.attributeId,
            ...valueMap,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!created) {
          return yield* Effect.die(
            new Error("Contact attribute value insert did not return a row")
          );
        }
        return created;
      }),

    findCompanyAttributeValues: (companyId: string) =>
      db
        .select()
        .from(schema.companyAttributeValueTable)
        .where(eq(schema.companyAttributeValueTable.companyId, companyId)),

    companyExists: (companyId: string, organizationId: string) =>
      db
        .select({ id: schema.companyTable.id })
        .from(schema.companyTable)
        .where(
          and(
            eq(schema.companyTable.id, companyId),
            eq(schema.companyTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] !== undefined)),

    upsertCompanyAttributeValue: (args: TCompanyAttributeValueUpsert) =>
      Effect.gen(function* () {
        const valueMap = buildAttributeValueColumns(args.value);

        if (args.id) {
          const [updated] = yield* db
            .update(schema.companyAttributeValueTable)
            .set({ ...valueMap, updatedAt: new Date() })
            .where(
              and(
                eq(schema.companyAttributeValueTable.id, args.id),
                eq(schema.companyAttributeValueTable.companyId, args.companyId)
              )
            )
            .returning();
          if (updated) {
            return updated;
          }
        }

        const id = args.id ?? (yield* CompanyAttributeValueId.generate);
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
  };
});

export class AttributeDefinitionRepository extends Context.Service<AttributeDefinitionRepository>()(
  "AttributeDefinitionRepository",
  { make: makeAttributeDefinitionRepository }
) {
  static readonly layer = Layer.effect(this, this.make);
}
