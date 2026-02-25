import { DB } from "@feeblo/db";
import {
  member as memberTable,
  organization as organizationTable,
} from "@feeblo/db/schema/auth";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

export class MembershipRepository extends Effect.Service<MembershipRepository>()(
  "MembershipRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DB;

      return {
        findMany: ({ userId }: { userId: string }) =>
          Effect.gen(function* () {
            const rows = yield* db
              .select({
                id: memberTable.id,
                organizationId: memberTable.organizationId,
                userId: memberTable.userId,
                role: memberTable.role,
                createdAt: memberTable.createdAt,
                organization: {
                  id: organizationTable.id,
                  name: organizationTable.name,
                  slug: organizationTable.slug,
                },
              })
              .from(memberTable)
              .innerJoin(
                organizationTable,
                eq(memberTable.organizationId, organizationTable.id)
              )
              .where(eq(memberTable.userId, userId));

            return rows;
          }),
      };
    }),
  }
) {}
