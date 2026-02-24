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
