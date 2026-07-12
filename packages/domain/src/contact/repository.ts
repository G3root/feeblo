import { currentDb, schema } from "@feeblo/db";
import {
  CompanyAttributeDefinitionId,
  CompanyAttributeValueId,
  CompanyId,
  ContactAttributeDefinitionId,
  ContactAttributeValueId,
  ContactId,
} from "@feeblo/id";
import { and, eq, or, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type {
  TCompanyAttributeDefinitionUpsert,
  TCompanyAttributeValueUpsert,
  TCompanyUpsert,
  TContactAttributeDefinitionUpsert,
  TContactAttributeValueUpsert,
  TContactDelete,
  TContactUpsert,
} from "./schema";

import { buildAttributeValueColumns, toMutableConfig } from "./utils";

export type Company = typeof schema.companyTable.$inferSelect;
export type Contact = typeof schema.contactTable.$inferSelect;

const makeContactRepository = Effect.succeed({
  upsertCompany: (args: TCompanyUpsert) =>
    Effect.gen(function* () {
      const db = yield* currentDb;

      const existing = yield* db
        .select({
          id: schema.companyTable.id,
        })
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

  deleteCompany: (args: { id: string; organizationId: string }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      return yield* db
        .delete(schema.companyTable)
        .where(
          and(
            eq(schema.companyTable.id, args.id),
            eq(schema.companyTable.organizationId, args.organizationId)
          )
        );
    }),

  upsertContact: (args: TContactUpsert) =>
    Effect.gen(function* () {
      const db = yield* currentDb;

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
          eq(schema.contactTable.externalId, externalId as string)
        );
      } else if (email) {
        conditions.push(eq(schema.contactTable.email, email as string));
      }

      const existing = yield* db
        .select({ id: schema.contactTable.id })
        .from(schema.contactTable)
        .where(and(...conditions))
        .limit(1)
        .pipe(Effect.map((rows) => rows[0]));

      if (existing) {
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
            updatedAt: new Date(),
          })
          .where(eq(schema.contactTable.id, existing.id))
          .returning();
        if (!updated) {
          return yield* Effect.die(
            new Error("Contact update did not return a row")
          );
        }
        return Option.some(updated);
      }

      const id = yield* ContactId.generate;
      const now = new Date();
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
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) {
        return yield* Effect.die(
          new Error("Contact insert did not return a row")
        );
      }
      return Option.some(created);
    }),

  findManyContacts: (organizationId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      return yield* db
        .select()
        .from(schema.contactTable)
        .where(eq(schema.contactTable.organizationId, organizationId));
    }),

  deleteContact: (args: TContactDelete) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      return yield* db
        .delete(schema.contactTable)
        .where(
          and(
            eq(schema.contactTable.id, args.id),
            eq(schema.contactTable.organizationId, args.organizationId)
          )
        );
    }),

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

  upsertContactAttributeDefinition: (args: TContactAttributeDefinitionUpsert) =>
    Effect.gen(function* () {
      const db = yield* currentDb;

      if (args.id) {
        const [updated = null] = yield* db
          .update(schema.contactAttributeDefinitionTable)
          .set({
            name: args.name,
            key: args.key,
            description: args.description ?? null,
            type: args.type,
            config: toMutableConfig(args.config),
            isRequired: args.isRequired ?? false,
            updatedAt: new Date(),
          })
          .where(eq(schema.contactAttributeDefinitionTable.id, args.id))
          .returning();
        if (!updated) {
          return yield* Effect.die(
            new Error(
              "Contact attribute definition update did not return a row"
            )
          );
        }
        return updated;
      }

      const id = yield* ContactAttributeDefinitionId.generate;
      const now = new Date();
      const [created = null] = yield* db
        .insert(schema.contactAttributeDefinitionTable)
        .values({
          id,
          organizationId: args.organizationId,
          name: args.name,
          key: args.key,
          description: args.description ?? null,
          type: args.type,
          config: toMutableConfig(args.config),
          isRequired: args.isRequired ?? false,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) {
        return yield* Effect.die(
          new Error("Contact attribute definition insert did not return a row")
        );
      }
      return created;
    }),

  deleteContactAttributeDefinition: (id: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      return yield* db
        .delete(schema.contactAttributeDefinitionTable)
        .where(eq(schema.contactAttributeDefinitionTable.id, id));
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

  upsertCompanyAttributeDefinition: (args: TCompanyAttributeDefinitionUpsert) =>
    Effect.gen(function* () {
      const db = yield* currentDb;

      if (args.id) {
        const [updated = null] = yield* db
          .update(schema.companyAttributeDefinitionTable)
          .set({
            name: args.name,
            key: args.key,
            description: args.description ?? null,
            type: args.type,
            config: toMutableConfig(args.config),
            isRequired: args.isRequired ?? false,
            updatedAt: new Date(),
          })
          .where(eq(schema.companyAttributeDefinitionTable.id, args.id))
          .returning();
        if (!updated) {
          return yield* Effect.die(
            new Error(
              "Company attribute definition update did not return a row"
            )
          );
        }
        return updated;
      }

      const id = yield* CompanyAttributeDefinitionId.generate;
      const now = new Date();
      const [created = null] = yield* db
        .insert(schema.companyAttributeDefinitionTable)
        .values({
          id,
          organizationId: args.organizationId,
          name: args.name,
          key: args.key,
          description: args.description ?? null,
          type: args.type,
          config: toMutableConfig(args.config),
          isRequired: args.isRequired ?? false,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) {
        return yield* Effect.die(
          new Error("Company attribute definition insert did not return a row")
        );
      }
      return created;
    }),

  deleteCompanyAttributeDefinition: (id: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      return yield* db
        .delete(schema.companyAttributeDefinitionTable)
        .where(eq(schema.companyAttributeDefinitionTable.id, id));
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
          .set({
            ...valueMap,
            updatedAt: new Date(),
          })
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
          .set({
            ...valueMap,
            updatedAt: new Date(),
          })
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

/**
 * @effect-expect-leaking Database
 */
export class ContactRepository extends Context.Service<ContactRepository>()(
  "ContactRepository",
  {
    make: makeContactRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
