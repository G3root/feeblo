import { DB } from "@feeblo/db";
import { member as memberTable } from "@feeblo/db/schema/auth";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { UnauthorizedError } from "./rpc-errors";
import { CurrentSession } from "./session-middleware";

export const requireOrganizationMembership = (organizationId: string) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession;
    const belongsToOrganization = session.organizations.some(
      (organization) => organization.id === organizationId
    );

    if (!belongsToOrganization) {
      return yield* Effect.fail(
        new UnauthorizedError({ message: "Membership not found" })
      );
    }
  });

export const isMemberOfOrganization = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const [isMember] = yield* db
      .select({
        id: memberTable.id,
      })
      .from(memberTable)
      .where(eq(memberTable.organizationId, organizationId))
      .limit(1);

    return isMember;
  });
