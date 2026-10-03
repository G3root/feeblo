import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as Policy from "./policy";
import {
  CurrentSession,
  OptionalCurrentSession,
  type Session,
} from "./session-middleware";

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

const unrestrictedSession: Session = {
  ...session,
  user: { ...session.user, restrictedToOrganizationId: null },
};

describe("hasRestrictedOrganizationScope", () => {
  it.effect("denies mutations outside a restricted user's organization", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Policy.hasRestrictedOrganizationScope("org_other")
      ).pipe(Effect.provideService(CurrentSession, session));

      expect(error._tag).toBe("PolicyDenied");
    })
  );

  it.effect("allows mutations in the restricted user's organization", () =>
    Policy.hasRestrictedOrganizationScope("org_allowed").pipe(
      Effect.provideService(CurrentSession, session)
    )
  );
});

describe("hasRestrictedOrganizationScopeIfPresent", () => {
  // `OptionalAuthMiddleware` provides `OptionalCurrentSession` and never
  // `CurrentSession`, so reading only the latter would make this a no-op that
  // allows every caller. Both provisionings are covered below.
  const withOptionalSession = (value: Session | null) =>
    Effect.provideService(
      OptionalCurrentSession,
      value === null ? Option.none() : Option.some(value)
    );

  it.effect("denies a restricted user outside its organization", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Policy.hasRestrictedOrganizationScopeIfPresent("org_other").pipe(
          withOptionalSession(session)
        )
      );

      expect(error._tag).toBe("PolicyDenied");
    })
  );

  it.effect(
    "denies a restricted user outside its organization on a CurrentSession route",
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          Policy.hasRestrictedOrganizationScopeIfPresent("org_other").pipe(
            Effect.provideService(CurrentSession, session)
          )
        );

        expect(error._tag).toBe("PolicyDenied");
      })
  );

  it.effect("allows a restricted user inside its organization", () =>
    Policy.hasRestrictedOrganizationScopeIfPresent("org_allowed").pipe(
      withOptionalSession(session)
    )
  );

  it.effect("allows an unrestricted session anywhere", () =>
    Policy.hasRestrictedOrganizationScopeIfPresent("org_other").pipe(
      withOptionalSession(unrestrictedSession)
    )
  );

  // A guest has no organization to confine. The handler decides separately
  // whether a guest may proceed at all, so this policy must not deny on the
  // absence of a session.
  it.effect("allows a request with no session", () =>
    Policy.hasRestrictedOrganizationScopeIfPresent("org_other").pipe(
      withOptionalSession(null)
    )
  );

  it.effect("allows a request when no session service is provided at all", () =>
    Policy.hasRestrictedOrganizationScopeIfPresent("org_other")
  );
});
