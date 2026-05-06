import { Database, schema } from "@feeblo/db";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

type TUpdate = {
  organizationId: string;
  name: string;
  logo: string | null;
};

const makeOrganizationRepository = Effect.gen(function* () {
  const db = yield* Database.Database;

  return {
    findManyByUserId: ({ userId }: { userId: string }) =>
      Effect.gen(function* () {
        const organizations = yield* db.makeQuery(
          (execute, input: { userId: string }) =>
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
        const [updatedOrganization] = yield* db.makeQuery(
          (execute, input: TUpdate) =>
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
        )({ organizationId, name, logo });

        return updatedOrganization;
      }),
    findMemberRole: ({
      organizationId,
      userId,
    }: {
      organizationId: string;
      userId: string;
    }) =>
      db
        .makeQuery(
          (execute, input: { organizationId: string; userId: string }) =>
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
        .pipe(Effect.map((rows) => rows[0])),
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
