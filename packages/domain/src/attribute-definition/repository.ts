import { currentDb, schema } from "@feeblo/db";
import { CompanyAttributeValueId, ContactAttributeValueId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { buildAttributeValueColumns } from "../contact/utils";
import type {
  TCompanyAttributeDefinitionCreate,
  TCompanyAttributeValueUpsert,
  TContactAttributeDefinitionCreate,
  TContactAttributeValueUpsert,
} from "./schema";

const makeAttributeDefinitionRepository = Effect.succeed({
  findContactAttributeDefinitions: (organizationId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      return yield* db
        .select()
        .from(schema.contactAttributeDefinitionTable)
        .where(
          eq(
            schema.contactAttributeDefinitionTable.organizationId,
            organizationId
          )
        );
    }),

  createContactAttributeDefinition: (args: TContactAttributeDefinitionCreate) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.contactAttributeDefinitionTable).values({
        ...args,
        description: args.description ?? null,
        config: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
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

  findContactAttributeValues: (contactId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      return yield* db
        .select()
        .from(schema.contactAttributeValueTable)
        .where(eq(schema.contactAttributeValueTable.contactId, contactId));
    }),

  upsertContactAttributeValue: (args: TContactAttributeValueUpsert) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const valueMap = buildAttributeValueColumns(args.value);

      if (args.id) {
        const [updated = null] = yield* db
          .update(schema.contactAttributeValueTable)
          .set({ ...valueMap, updatedAt: new Date() })
          .where(eq(schema.contactAttributeValueTable.id, args.id))
          .returning();
        if (!updated) {
          return yield* Effect.die(
            new Error("Contact attribute value update did not return a row")
          );
        }
        return updated;
      }

      const id = yield* ContactAttributeValueId.generate;
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
export class AttributeDefinitionRepository extends Context.Service<AttributeDefinitionRepository>()(
  "AttributeDefinitionRepository",
  { make: makeAttributeDefinitionRepository }
) {
  static readonly layer = Layer.effect(this, this.make);
}
