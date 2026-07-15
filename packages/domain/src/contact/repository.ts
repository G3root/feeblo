import { currentDb, schema } from "@feeblo/db";
import { ContactAttributeValueId, ContactId } from "@feeblo/id";
import { and, eq, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type {
  TContactAttributeDefinitionCreate,
  TContactAttributeValueUpsert,
  TContactUpsert,
} from "./schema";

import { buildAttributeValueColumns } from "./utils";

export type Contact = typeof schema.contactTable.$inferSelect;

const makeContactRepository = Effect.succeed({
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
