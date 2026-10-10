import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { redactActorIdentities } from "./public-actor";
import { currentPublicViewer, withPublicViewer } from "./public-read";
import { OptionalCurrentSession, type Session } from "./session-middleware";

const makeSession = (userId: string, organizationId: string): Session => ({
  memberships: [
    { membershipId: "membership-1", organizationId, role: "owner" },
  ],
  organizations: [{ id: organizationId }],
  session: { token: "test-token", userId },
  user: { email: "user@example.com", id: userId, name: "Test User" },
});

const anonymous = Effect.provideService(OptionalCurrentSession, Option.none());

describe("withPublicViewer", () => {
  it.effect("redacts actor identifiers for an anonymous viewer", () =>
    Effect.gen(function* () {
      const rows = [{ memberId: "member-1", userId: "user-1" }];

      const result = yield* withPublicViewer({
        read: () => Effect.succeed(rows),
        redact: redactActorIdentities,
      }).pipe(anonymous);

      expect(result).toEqual([{ memberId: null, userId: null }]);
    })
  );

  it.effect("keeps the viewer's own identifiers and redacts the rest", () =>
    Effect.gen(function* () {
      const rows = [
        { memberId: "member-1", userId: "user-1" },
        { memberId: "member-2", userId: "user-2" },
      ];

      const result = yield* withPublicViewer({
        read: () => Effect.succeed(rows),
        redact: redactActorIdentities,
      }).pipe(
        Effect.provideService(
          OptionalCurrentSession,
          Option.some(makeSession("user-1", "org-1"))
        )
      );

      expect(result).toEqual([
        { memberId: "member-1", userId: "user-1" },
        { memberId: null, userId: null },
      ]);
    })
  );
});

describe("currentPublicViewer", () => {
  it.effect("reports membership for the viewer's organization", () =>
    Effect.gen(function* () {
      const viewer = yield* currentPublicViewer.pipe(
        Effect.provideService(
          OptionalCurrentSession,
          Option.some(makeSession("user-1", "org-1"))
        )
      );

      expect(viewer.isMember("org-1")).toBe(true);
      expect(viewer.isMember("org-2")).toBe(false);
    })
  );

  it.effect("is anonymous without a session", () =>
    Effect.gen(function* () {
      const viewer = yield* currentPublicViewer.pipe(anonymous);

      expect(viewer.userId).toBeUndefined();
      expect(viewer.isMember("org-1")).toBe(false);
    })
  );
});
