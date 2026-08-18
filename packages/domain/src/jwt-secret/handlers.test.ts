import { NodeCrypto } from "@effect/platform-node";
import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import type { Role } from "@feeblo/permissions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CurrentSession, type Session } from "../session-middleware";
import { JwtSecretRpcHandlersEffect } from "./handlers";
import { JwtSecretRepository } from "./repository";

describe("JwtSecretRpcHandlers", () => {
  type Fixture = {
    membershipId: string;
    organizationId: string;
    userId: string;
  };

  const makeSession = (fixture: Fixture, role: Role = "owner"): Session => ({
    user: {
      id: fixture.userId,
      email: "user@example.com",
      name: "Test User",
      restrictedToOrganizationId: null,
    },
    session: { userId: fixture.userId, token: "test-token" },
    organizations: [{ id: fixture.organizationId }],
    memberships: [
      {
        membershipId: fixture.membershipId,
        organizationId: fixture.organizationId,
        role,
      },
    ],
  });

  const makeFixture = () =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const userId = `user_${organizationId}`;
      const membershipId = `membership_${organizationId}`;
      const now = new Date();
      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Test organization",
        slug: organizationId,
        createdAt: now,
      });
      yield* db.insert(schema.userTable).values({
        id: userId,
        email: `${organizationId}@example.com`,
        name: "Test User",
      });
      yield* db.insert(schema.memberTable).values({
        id: membershipId,
        organizationId,
        userId,
        role: "owner",
        createdAt: now,
      });
      return { membershipId, organizationId, userId } satisfies Fixture;
    });

  const TestLayer = Layer.merge(
    JwtSecretRepository.layer.pipe(
      Layer.provideMerge(Database.PgliteDatabaseLive)
    ),
    NodeCrypto.layer
  );

  layer(TestLayer)("handlers", (it) => {
    it.effect("returns an empty list until a secret is generated", () =>
      Effect.gen(function* () {
        const handlers = yield* JwtSecretRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const secrets = yield* handlers
          .JwtSecretList({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
        expect(secrets).toHaveLength(0);
      })
    );

    it.effect("creates the active secret on first rotation", () =>
      Effect.gen(function* () {
        const handlers = yield* JwtSecretRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const session = makeSession(fixture);

        yield* handlers
          .JwtSecretRotate({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, session));

        const secrets = yield* handlers
          .JwtSecretList({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, session));
        expect(secrets).toHaveLength(1);
        expect(secrets[0]).toMatchObject({
          organizationId: fixture.organizationId,
          revokedAt: null,
        });
        expect(secrets[0]?.secret).toHaveLength(64);
      })
    );

    it.effect("rejects members from managing secrets", () =>
      Effect.gen(function* () {
        const handlers = yield* JwtSecretRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const error = yield* Effect.flip(
          handlers
            .JwtSecretRotate({ organizationId: fixture.organizationId })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            )
        );
        expect(error._tag).toBe("PolicyDenied");
      })
    );

    it.effect("rotates the active secret for admins", () =>
      Effect.gen(function* () {
        const handlers = yield* JwtSecretRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const session = makeSession(fixture, "admin");

        // Generate the initial secret first (creation is explicit now).
        yield* handlers
          .JwtSecretRotate({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, session));
        const initial = yield* handlers
          .JwtSecretList({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, session));

        yield* handlers
          .JwtSecretRotate({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, session));
        const rotated = yield* handlers
          .JwtSecretList({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, session));
        expect(rotated).toHaveLength(2);
        expect(
          rotated.find((secret) => secret.revokedAt === null)?.id
        ).not.toBe(initial[0]?.id);
      })
    );
  });
});
