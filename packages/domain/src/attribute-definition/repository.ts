import { currentDb, schema } from "@feeblo/db";
import { CompanyAttributeValueId, ContactAttributeValueId } from "@feeblo/id";
import { toCamelCaseAttributeKey } from "@feeblo/utils/scule";
import { and, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { buildAttributeValueColumns } from "../contact/utils";
import { FailedToUpsertAttributeValueError } from "./errors";
import type {
  TCompanyAttributeDefinitionCreate,
  TCompanyAttributeDefinitionDelete,
  TCompanyAttributeDefinitionUpdate,
  TCompanyAttributeValueUpdate,
  TCompanyAttributeValueUpsert,
  TContactAttributeDefinitionCreate,
  TContactAttributeDefinitionDelete,
  TContactAttributeDefinitionUpdate,
  TContactAttributeValueUpdate,
  TContactAttributeValueUpsert,
} from "./schema";

type AttributeValue = Parameters<typeof buildAttributeValueColumns>[0];

type AttributeValueMap = ReturnType<typeof buildAttributeValueColumns>;

/**
 * Shared update for one attribute value row.
 *
 * `update` must scope by every column the caller names (row id, owner,
 * attribute, organization), because the value was validated against that
 * attribute's definition — writing a different attribute's row would store a
 * value the validation did not check.
 *
 * `strict` marks the Update RPC's integral semantics: a miss means the named
 * row does not exist for this (owner, attribute) pair — a stale or mismatched
 * caller id — and the write fails rather than settling a different row
 * quietly. The upsert entry points pass `strict: false`: the miss then falls
 * to `insert`, whose (owner, attribute) pair is unique, so the insert is
 * written with an upsert that updates the winning row in place rather than
 * surfacing a unique violation.
 *
 * `idExists` guards that fallback: `update` scopes by (owner, attribute), so
 * its miss proves the pair has no row, not that the caller's id is free. An id
 * that names another attribute's (or owner's) row would otherwise reach
 * `insert` and hit its primary key, which the (owner, attribute) conflict
 * target does not cover, so the caller would see a driver error instead of the
 * controlled mismatch the strict path reports.
 */
const upsertAttributeValue = <T, E1, R1, E2, R2, E3, R3, E4, R4>(
  args: { id?: string | undefined; value: AttributeValue | undefined },
  options: {
    /** Called only when the caller named a row id; it is the narrowed id. */
    update: (
      rowId: string,
      valueMap: AttributeValueMap
    ) => Effect.Effect<T | undefined, E1, R1>;
    insert: (
      id: string,
      valueMap: AttributeValueMap
    ) => Effect.Effect<T | undefined, E2, R2>;
    /** Whether a row already holds the id, in any owner or attribute. */
    idExists: (id: string) => Effect.Effect<boolean, E4, R4>;
    generateId: Effect.Effect<string, E3, R3>;
    readonly strict: boolean;
  }
) =>
  Effect.gen(function* () {
    const valueMap = buildAttributeValueColumns(args.value);

    if (args.id !== undefined) {
      const updated = yield* options.update(args.id, valueMap);
      if (updated !== undefined) {
        return updated;
      }
      if (options.strict) {
        return yield* new FailedToUpsertAttributeValueError();
      }
    } else if (options.strict) {
      return yield* new FailedToUpsertAttributeValueError();
    }

    const id = args.id ?? (yield* options.generateId);
    if (args.id !== undefined && (yield* options.idExists(id))) {
      return yield* new FailedToUpsertAttributeValueError();
    }
    const created = yield* options.insert(id, valueMap);
    if (!created) {
      return yield* new FailedToUpsertAttributeValueError();
    }
    return created;
  });

const makeAttributeDefinitionRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  const contactAttributeValueIdExists = (id: string) =>
    db
      .select({ id: schema.contactAttributeValueTable.id })
      .from(schema.contactAttributeValueTable)
      .where(eq(schema.contactAttributeValueTable.id, id))
      .limit(1)
      .pipe(Effect.map((rows) => rows[0] !== undefined));

  const companyAttributeValueIdExists = (id: string) =>
    db
      .select({ id: schema.companyAttributeValueTable.id })
      .from(schema.companyAttributeValueTable)
      .where(eq(schema.companyAttributeValueTable.id, id))
      .limit(1)
      .pipe(Effect.map((rows) => rows[0] !== undefined));

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
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        yield* db
          .insert(schema.contactAttributeDefinitionTable)
          .values({
            ...args,
            key: toCamelCaseAttributeKey(args.name),
            description: args.description ?? null,
            config: null,
            createdAt: now,
            updatedAt: now,
          })
          .pipe(Effect.asVoid);
      }),

    updateContactAttributeDefinition: (
      args: TContactAttributeDefinitionUpdate
    ) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        yield* db
          .update(schema.contactAttributeDefinitionTable)
          .set({
            name: args.name,
            key: toCamelCaseAttributeKey(args.name),
            description: args.description,
            isRequired: args.isRequired,
            updatedAt: now,
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
          .pipe(Effect.asVoid);
      }),

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

    findContactAttributeDefinitionById: (
      args: TContactAttributeDefinitionDelete
    ) =>
      db
        .select()
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
        .pipe(Effect.map((rows) => rows[0])),

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
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        yield* db
          .insert(schema.companyAttributeDefinitionTable)
          .values({
            ...args,
            key: toCamelCaseAttributeKey(args.name),
            description: args.description ?? null,
            config: null,
            createdAt: now,
            updatedAt: now,
          })
          .pipe(Effect.asVoid);
      }),

    updateCompanyAttributeDefinition: (
      args: TCompanyAttributeDefinitionUpdate
    ) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        yield* db
          .update(schema.companyAttributeDefinitionTable)
          .set({
            name: args.name,
            key: toCamelCaseAttributeKey(args.name),
            description: args.description,
            isRequired: args.isRequired,
            updatedAt: now,
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
          .pipe(Effect.asVoid);
      }),

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

    findCompanyAttributeDefinitionById: (
      args: TCompanyAttributeDefinitionDelete
    ) =>
      db
        .select()
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
        .pipe(Effect.map((rows) => rows[0])),

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
        strict: true,
        idExists: contactAttributeValueIdExists,
        update: (rowId, valueMap) =>
          Effect.gen(function* () {
            const now = yield* DateTime.nowAsDate;
            return yield* db
              .update(schema.contactAttributeValueTable)
              .set({ ...valueMap, updatedAt: now })
              .where(
                and(
                  eq(schema.contactAttributeValueTable.id, rowId),
                  // The row must be the named attribute's: the value was
                  // validated against that definition, so a mismatched id
                  // must not silently write another attribute's row.
                  eq(
                    schema.contactAttributeValueTable.attributeId,
                    args.attributeId
                  ),
                  eq(
                    schema.contactAttributeValueTable.contactId,
                    args.contactId
                  ),
                  eq(
                    schema.contactAttributeValueTable.organizationId,
                    args.organizationId
                  )
                )
              )
              .returning()
              .pipe(Effect.map(([updated]) => updated));
          }),
        insert: (id, valueMap) =>
          Effect.gen(function* () {
            const now = yield* DateTime.nowAsDate;
            return yield* db
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
              // The (contact, attribute) pair is unique: a row that already
              // exists for this pair — raced or pre-existing — is updated in
              // place rather than surfacing a unique violation.
              .onConflictDoUpdate({
                target: [
                  schema.contactAttributeValueTable.contactId,
                  schema.contactAttributeValueTable.attributeId,
                ],
                set: { ...valueMap, updatedAt: now },
              })
              .returning()
              .pipe(Effect.map(([created]) => created));
          }),
        generateId: ContactAttributeValueId.generate,
      }).pipe(Effect.asVoid),

    upsertContactAttributeValue: (args: TContactAttributeValueUpsert) =>
      upsertAttributeValue(args, {
        strict: false,
        idExists: contactAttributeValueIdExists,
        update: (rowId, valueMap) =>
          Effect.gen(function* () {
            const now = yield* DateTime.nowAsDate;
            return yield* db
              .update(schema.contactAttributeValueTable)
              .set({ ...valueMap, updatedAt: now })
              .where(
                and(
                  eq(schema.contactAttributeValueTable.id, rowId),
                  // Same scope rule as the update path: the named attribute
                  // must own the row the id points at.
                  eq(
                    schema.contactAttributeValueTable.attributeId,
                    args.attributeId
                  ),
                  eq(
                    schema.contactAttributeValueTable.contactId,
                    args.contactId
                  ),
                  eq(
                    schema.contactAttributeValueTable.organizationId,
                    args.organizationId
                  )
                )
              )
              .returning()
              .pipe(Effect.map(([updated]) => updated));
          }),
        insert: (id, valueMap) =>
          Effect.gen(function* () {
            const now = yield* DateTime.nowAsDate;
            return yield* db
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
              .onConflictDoUpdate({
                target: [
                  schema.contactAttributeValueTable.contactId,
                  schema.contactAttributeValueTable.attributeId,
                ],
                set: { ...valueMap, updatedAt: now },
              })
              .returning()
              .pipe(Effect.map(([created]) => created));
          }),
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
        strict: true,
        idExists: companyAttributeValueIdExists,
        update: (rowId, valueMap) =>
          Effect.gen(function* () {
            const now = yield* DateTime.nowAsDate;
            return yield* db
              .update(schema.companyAttributeValueTable)
              .set({ ...valueMap, updatedAt: now })
              .where(
                and(
                  eq(schema.companyAttributeValueTable.id, rowId),
                  // The row must be the named attribute's: the value was
                  // validated against that definition, so a mismatched id
                  // must not silently write another attribute's row.
                  eq(
                    schema.companyAttributeValueTable.attributeId,
                    args.attributeId
                  ),
                  eq(
                    schema.companyAttributeValueTable.companyId,
                    args.companyId
                  ),
                  eq(
                    schema.companyAttributeValueTable.organizationId,
                    args.organizationId
                  )
                )
              )
              .returning()
              .pipe(Effect.map(([updated]) => updated));
          }),
        insert: (id, valueMap) =>
          Effect.gen(function* () {
            const now = yield* DateTime.nowAsDate;
            return yield* db
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
              // The (company, attribute) pair is unique: a row that already
              // exists for this pair — raced or pre-existing — is updated in
              // place rather than surfacing a unique violation.
              .onConflictDoUpdate({
                target: [
                  schema.companyAttributeValueTable.companyId,
                  schema.companyAttributeValueTable.attributeId,
                ],
                set: { ...valueMap, updatedAt: now },
              })
              .returning()
              .pipe(Effect.map(([created]) => created));
          }),
        generateId: CompanyAttributeValueId.generate,
      }).pipe(Effect.asVoid),

    upsertCompanyAttributeValue: (args: TCompanyAttributeValueUpsert) =>
      upsertAttributeValue(args, {
        strict: false,
        idExists: companyAttributeValueIdExists,
        update: (rowId, valueMap) =>
          Effect.gen(function* () {
            const now = yield* DateTime.nowAsDate;
            return yield* db
              .update(schema.companyAttributeValueTable)
              .set({ ...valueMap, updatedAt: now })
              .where(
                and(
                  eq(schema.companyAttributeValueTable.id, rowId),
                  // Same scope rule as the update path: the named attribute
                  // must own the row the id points at.
                  eq(
                    schema.companyAttributeValueTable.attributeId,
                    args.attributeId
                  ),
                  eq(
                    schema.companyAttributeValueTable.companyId,
                    args.companyId
                  ),
                  eq(
                    schema.companyAttributeValueTable.organizationId,
                    args.organizationId
                  )
                )
              )
              .returning()
              .pipe(Effect.map(([updated]) => updated));
          }),
        insert: (id, valueMap) =>
          Effect.gen(function* () {
            const now = yield* DateTime.nowAsDate;
            return yield* db
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
              .onConflictDoUpdate({
                target: [
                  schema.companyAttributeValueTable.companyId,
                  schema.companyAttributeValueTable.attributeId,
                ],
                set: { ...valueMap, updatedAt: now },
              })
              .returning()
              .pipe(Effect.map(([created]) => created));
          }),
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
