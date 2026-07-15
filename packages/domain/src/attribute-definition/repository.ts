import { currentDb, schema } from "@feeblo/db";
import { CompanyAttributeValueId, ContactAttributeValueId } from "@feeblo/id";
import { toCamelCaseAttributeKey } from "@feeblo/utils/scule";
import { and, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { buildAttributeValueColumns } from "../contact/utils";
import { FailedToUpsertAttributeValueError } from "./errors";
import type {
  TCompanyAttributeDefinitionCreate,
  TCompanyAttributeDefinitionDelete,
  TCompanyAttributeDefinitionUpdate,
  TCompanyAttributeValueUpsert,
  TCompanyAttributeValueUpdate,
  TContactAttributeDefinitionCreate,
  TContactAttributeDefinitionDelete,
  TContactAttributeDefinitionUpdate,
  TContactAttributeValueUpsert,
  TContactAttributeValueUpdate,
} from "./schema";

type AttributeValue = Parameters<typeof buildAttributeValueColumns>[0];

const upsertAttributeValue = <T, E1, R1, E2, R2, E3, R3>(
  args: { id?: string | undefined; value: AttributeValue | undefined },
  options: {
    update: (
      id: string,
      valueMap: ReturnType<typeof buildAttributeValueColumns>
    ) => Effect.Effect<T | undefined, E1, R1>;
    create: (
      id: string,
      valueMap: ReturnType<typeof buildAttributeValueColumns>
    ) => Effect.Effect<T | undefined, E2, R2>;
    generateId: Effect.Effect<string, E3, R3>;
  }
) =>
  Effect.gen(function* () {
    const valueMap = buildAttributeValueColumns(args.value);

    if (args.id) {
      const updated = yield* options.update(args.id, valueMap);
      if (updated) {
        return updated;
      }
    }

    const id = args.id ?? (yield* options.generateId);
    const created = yield* options.create(id, valueMap);
    if (!created) {
      return yield* new FailedToUpsertAttributeValueError();
    }
    return created;
  });

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
          key: toCamelCaseAttributeKey(args.name),
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
          key: toCamelCaseAttributeKey(args.name),
          description: args.description,
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
          key: toCamelCaseAttributeKey(args.name),
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
          key: toCamelCaseAttributeKey(args.name),
          description: args.description,
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

    findContactAttributeValues: (organizationId: string) =>
      db
        .select()
        .from(schema.contactAttributeValueTable)
        .where(
          eq(schema.contactAttributeValueTable.organizationId, organizationId)
        ),

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

    updateContactAttributeValue: (args: TContactAttributeValueUpdate) =>
      upsertAttributeValue(args, {
        update: (id, valueMap) =>
          db
            .update(schema.contactAttributeValueTable)
            .set({ ...valueMap, updatedAt: new Date() })
            .where(
              and(
                eq(schema.contactAttributeValueTable.id, id),
                eq(schema.contactAttributeValueTable.contactId, args.contactId),
                eq(
                  schema.contactAttributeValueTable.organizationId,
                  args.organizationId
                )
              )
            )
            .returning()
            .pipe(Effect.map(([updated]) => updated)),
        create: (id, valueMap) => {
          const now = new Date();
          return db
            .insert(schema.contactAttributeValueTable)
            .values({
              id,
              organizationId: args.organizationId,
              contactId: args.contactId,
              attributeId: args.attributeId,
              ...valueMap,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .pipe(Effect.map(([created]) => created));
        },
        generateId: ContactAttributeValueId.generate,
      }).pipe(Effect.asVoid),

    upsertContactAttributeValue: (args: TContactAttributeValueUpsert) =>
      upsertAttributeValue(args, {
        update: (id, valueMap) =>
          db
            .update(schema.contactAttributeValueTable)
            .set({ ...valueMap, updatedAt: new Date() })
            .where(
              and(
                eq(schema.contactAttributeValueTable.id, id),
                eq(schema.contactAttributeValueTable.contactId, args.contactId),
                eq(
                  schema.contactAttributeValueTable.organizationId,
                  args.organizationId
                )
              )
            )
            .returning()
            .pipe(Effect.map(([updated]) => updated)),
        create: (id, valueMap) => {
          const now = new Date();
          return db
            .insert(schema.contactAttributeValueTable)
            .values({
              id,
              organizationId: args.organizationId,
              contactId: args.contactId,
              attributeId: args.attributeId,
              ...valueMap,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .pipe(Effect.map(([created]) => created));
        },
        generateId: ContactAttributeValueId.generate,
      }),

    findCompanyAttributeValues: (organizationId: string) =>
      db
        .select()
        .from(schema.companyAttributeValueTable)
        .where(
          eq(schema.companyAttributeValueTable.organizationId, organizationId)
        ),

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

    updateCompanyAttributeValue: (args: TCompanyAttributeValueUpdate) =>
      upsertAttributeValue(args, {
        update: (id, valueMap) =>
          db
            .update(schema.companyAttributeValueTable)
            .set({ ...valueMap, updatedAt: new Date() })
            .where(
              and(
                eq(schema.companyAttributeValueTable.id, id),
                eq(schema.companyAttributeValueTable.companyId, args.companyId),
                eq(
                  schema.companyAttributeValueTable.organizationId,
                  args.organizationId
                )
              )
            )
            .returning()
            .pipe(Effect.map(([updated]) => updated)),
        create: (id, valueMap) => {
          const now = new Date();
          return db
            .insert(schema.companyAttributeValueTable)
            .values({
              id,
              organizationId: args.organizationId,
              companyId: args.companyId,
              attributeId: args.attributeId,
              ...valueMap,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .pipe(Effect.map(([created]) => created));
        },
        generateId: CompanyAttributeValueId.generate,
      }).pipe(Effect.asVoid),

    upsertCompanyAttributeValue: (args: TCompanyAttributeValueUpsert) =>
      upsertAttributeValue(args, {
        update: (id, valueMap) =>
          db
            .update(schema.companyAttributeValueTable)
            .set({ ...valueMap, updatedAt: new Date() })
            .where(
              and(
                eq(schema.companyAttributeValueTable.id, id),
                eq(schema.companyAttributeValueTable.companyId, args.companyId),
                eq(
                  schema.companyAttributeValueTable.organizationId,
                  args.organizationId
                )
              )
            )
            .returning()
            .pipe(Effect.map(([updated]) => updated)),
        create: (id, valueMap) => {
          const now = new Date();
          return db
            .insert(schema.companyAttributeValueTable)
            .values({
              id,
              organizationId: args.organizationId,
              companyId: args.companyId,
              attributeId: args.attributeId,
              ...valueMap,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .pipe(Effect.map(([created]) => created));
        },
        generateId: CompanyAttributeValueId.generate,
      }),
  };
});

export class AttributeDefinitionRepository extends Context.Service<AttributeDefinitionRepository>()(
  "AttributeDefinitionRepository",
  { make: makeAttributeDefinitionRepository }
) {
  static readonly layer = Layer.effect(this, this.make);
}
