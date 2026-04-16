import { DB } from "@feeblo/db";
import {
  member as memberTable,
  organization as organizationTable,
} from "@feeblo/db/schema/auth";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { Organization } from "./schema";

type TUpdate = {
  organizationId: string;
  name: string;
  logo: string | null;
};

const makeOrganizationRepository = Effect.gen(function* () {
  const db = yield* DB;

  return {
    findManyByUserId: ({ userId }: { userId: string }) =>
      Effect.gen(function* () {
        const organizations = yield* db
          .select({
            id: organizationTable.id,
            name: organizationTable.name,
            slug: organizationTable.slug,
            logo: organizationTable.logo,
            createdAt: organizationTable.createdAt,
          })
          .from(memberTable)
          .innerJoin(
            organizationTable,
            eq(memberTable.organizationId, organizationTable.id)
          )
          .where(eq(memberTable.userId, userId));

        return organizations.map(
          (entry) =>
            new Organization({
              id: entry.id,
              name: entry.name,
              slug: entry.slug,
              logo: entry.logo,
              createdAt: entry.createdAt,
            })
        );
      }),
    update: ({ organizationId, name, logo }: TUpdate) =>
      Effect.gen(function* () {
        const [updatedOrganization] = yield* db
          .update(organizationTable)
          .set({
            logo,
            name,
          })
          .where(eq(organizationTable.id, organizationId))
          .returning({
            id: organizationTable.id,
            name: organizationTable.name,
            slug: organizationTable.slug,
            logo: organizationTable.logo,
            createdAt: organizationTable.createdAt,
          });

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
        .select({
          role: memberTable.role,
        })
        .from(memberTable)
        .where(
          and(
            eq(memberTable.organizationId, organizationId),
            eq(memberTable.userId, userId)
          )
        )
        .pipe(Effect.map((rows) => rows[0])),
  };
});

export class OrganizationRepository extends Effect.Service<OrganizationRepository>()(
  "OrganizationRepository",
  {
    effect: makeOrganizationRepository,
  }
) {
  static readonly layer = this.Default;
}
