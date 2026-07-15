import { currentDb, schema } from "@feeblo/db";
import { ContactId } from "@feeblo/id";
import { and, eq, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type {
  TContactCreate,
  TContactDelete,
  TContactUpdate,
  TContactUpsert,
} from "./schema";

export type Contact = typeof schema.contactTable.$inferSelect;

const makeContactRepository = Effect.succeed({
  create: (args: TContactCreate) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const id = yield* ContactId.generate;
      const now = new Date();
      const [created] = yield* db
        .insert(schema.contactTable)
        .values({
          id,
          organizationId: args.organizationId,
          externalId: args.externalId,
          email: args.email,
          name: args.name,
          phone: args.phone,
          avatar: args.avatar,
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
      return created;
    }),

  update: (args: TContactUpdate) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const [updated] = yield* db
        .update(schema.contactTable)
        .set({
          ...(args.externalId !== undefined && {
            externalId: args.externalId,
          }),
          ...(args.email !== undefined && { email: args.email }),
          ...(args.name !== undefined && { name: args.name }),
          ...(args.phone !== undefined && { phone: args.phone }),
          ...(args.avatar !== undefined && { avatar: args.avatar }),
          ...(args.companyId !== undefined && { companyId: args.companyId }),
          ...(args.userId !== undefined && { userId: args.userId }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.contactTable.id, args.id),
            eq(schema.contactTable.organizationId, args.organizationId)
          )
        )
        .returning();

      return Option.fromNullishOr(updated);
    }),

  delete: (args: TContactDelete) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const [deleted] = yield* db
        .delete(schema.contactTable)
        .where(
          and(
            eq(schema.contactTable.id, args.id),
            eq(schema.contactTable.organizationId, args.organizationId)
          )
        )
        .returning({ id: schema.contactTable.id });

      return Option.fromNullishOr(deleted);
    }),

  exists: ({ id, organizationId }: TContactDelete) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const [contact] = yield* db
        .select({ id: schema.contactTable.id })
        .from(schema.contactTable)
        .where(
          and(
            eq(schema.contactTable.id, id),
            eq(schema.contactTable.organizationId, organizationId)
          )
        )
        .limit(1);
      return contact !== undefined;
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
