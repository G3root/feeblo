import { currentDb, schema } from "@feeblo/db";
import { CompanyId, ContactId } from "@feeblo/id";
import { and, eq, or, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type { TCompanyUpsert, TContactUpsert } from "./schema";

export type Company = typeof schema.companyTable.$inferSelect;
export type Contact = typeof schema.contactTable.$inferSelect;

const makeContactRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    upsertCompany: (args: TCompanyUpsert) =>
      Effect.gen(function* () {
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
              ...(args.domain && { domain: args.domain }),
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
            domain: args.domain,
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

    upsertContact: (args: TContactUpsert) =>
      Effect.gen(function* () {
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
              ...(args.companyId !== undefined && {
                companyId: args.companyId,
              }),
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
            externalId: args.externalId,
            companyId: args.companyId,
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
  };
});

export class ContactRepository extends Context.Service<ContactRepository>()(
  "ContactRepository",
  {
    make: makeContactRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
