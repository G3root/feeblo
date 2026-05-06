import { Database, schema } from "@feeblo/db";
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
  const db = yield* Database.Database;

  return {
    findManyByUserId: ({ userId }: TFindManyByUserId) =>
      Effect.gen(function* () {
        const organizations = yield* db.makeQuery(
          (execute, input: TFindManyByUserId) =>
            execute((client) =>
              client
                .select({
                  id: schema.organizationTable.id,
                  name: schema.organizationTable.name,
                  slug: schema.organizationTable.slug,
                  logo: schema.organizationTable.logo,
                  createdAt: schema.organizationTable.createdAt,
                })
                .from(schema.member)
                .innerJoin(
                  schema.organizationTable,
                  eq(schema.member.organizationId, schema.organizationTable.id)
                )
                .where(eq(schema.member.userId, input.userId))
            )
        )({ userId });

        return organizations;
      }),
    update: ({ organizationId, name, logo }: TUpdate) =>
      Effect.gen(function* () {
        const updatedOrganization = yield* db
          .makeQuery((execute, input: TUpdate) =>
            execute((client) =>
              client
                .update(schema.organizationTable)
                .set({
                  logo: input.logo,
                  name: input.name,
                })
                .where(eq(schema.organizationTable.id, input.organizationId))
                .returning({
                  id: schema.organizationTable.id,
                  name: schema.organizationTable.name,
                  slug: schema.organizationTable.slug,
                  logo: schema.organizationTable.logo,
                  createdAt: schema.organizationTable.createdAt,
                })
            )
          )({ organizationId, name, logo })
          .pipe(Effect.map(EffectArray.get(0)));

        return updatedOrganization;
      }),
    findMemberRole: ({ organizationId, userId }: TFindMemberRole) =>
      db
        .makeQuery((execute, input: TFindMemberRole) =>
          execute((client) =>
            client
              .select({
                role: schema.member.role,
              })
              .from(schema.member)
              .where(
                and(
                  eq(schema.member.organizationId, input.organizationId),
                  eq(schema.member.userId, input.userId)
                )
              )
          )
        )({ organizationId, userId })
        .pipe(
          Effect.map(EffectArray.get(0)),
          Effect.map((row) =>
            Option.match(row, {
              onNone: () => undefined,
              onSome: (value) => value,
            })
          )
        ),
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
