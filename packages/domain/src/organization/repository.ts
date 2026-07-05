import { schema, currentDb } from "@feeblo/db";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Array as EffectArray, Layer, Option } from "effect";

interface TUpdate {
  logo: string | null;
  name: string;
  organizationId: string;
}

interface TFindManyByUserId {
  userId: string;
}

interface TFindMemberRole {
  organizationId: string;
  userId: string;
}

const makeOrganizationRepository = Effect.gen(function* () {
  return {
    findManyByUserId: ({ userId }: TFindManyByUserId) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({
            id: schema.organizationTable.id,
            name: schema.organizationTable.name,
            slug: schema.organizationTable.slug,
            logo: schema.organizationTable.logo,
            createdAt: schema.organizationTable.createdAt,
          })
          .from(schema.memberTable)
          .innerJoin(
            schema.organizationTable,
            eq(
              schema.memberTable.organizationId,
              schema.organizationTable.id
            )
          )
          .where(eq(schema.memberTable.userId, userId));
      }),
    update: ({ organizationId, name, logo }: TUpdate) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .update(schema.organizationTable)
          .set({
            logo,
            name,
          })
          .where(eq(schema.organizationTable.id, organizationId))
          .returning({
            id: schema.organizationTable.id,
            name: schema.organizationTable.name,
            slug: schema.organizationTable.slug,
            logo: schema.organizationTable.logo,
            createdAt: schema.organizationTable.createdAt,
          })
          .pipe(Effect.map(EffectArray.get(0)));
      }),
    findMemberRole: ({ organizationId, userId }: TFindMemberRole) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({
            role: schema.memberTable.role,
          })
          .from(schema.memberTable)
          .where(
            and(
              eq(schema.memberTable.organizationId, organizationId),
              eq(schema.memberTable.userId, userId)
            )
          )
          .pipe(
            Effect.map(EffectArray.get(0)),
            Effect.map((row) =>
              Option.match(row, {
                onNone: () => undefined,
                onSome: (value) => value,
              })
            )
          );
      }),
  };
});

export class OrganizationRepository extends Context.Service<OrganizationRepository>()(
  "OrganizationRepository",
  {
    make: makeOrganizationRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
