import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import * as Policy from "./policy";
import { CurrentSession, type Session } from "./session-middleware";

const session: Session = {
  user: {
    id: "user_1",
    email: "user@example.com",
    name: "Restricted user",
    restrictedToOrganizationId: "org_allowed",
  },
  session: { userId: "user_1", token: "token" },
  organizations: [],
  memberships: [],
};

describe("hasRestrictedOrganizationScope", () => {
  it("denies mutations outside a restricted user's organization", async () => {
    const error = await Effect.runPromise(
      Effect.flip(Policy.hasRestrictedOrganizationScope("org_other")).pipe(
        Effect.provideService(CurrentSession, session)
      )
    );

    expect(error._tag).toBe("PolicyDenied");
  });

  it("allows mutations in the restricted user's organization", async () => {
    await Effect.runPromise(
      Policy.hasRestrictedOrganizationScope("org_allowed").pipe(
        Effect.provideService(CurrentSession, session)
      )
    );
  });
});
