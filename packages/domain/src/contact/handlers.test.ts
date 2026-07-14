import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { CurrentSession, type Session } from "../session-middleware";
import { ContactRpcHandlersEffect } from "./handlers";
import { ContactRepository } from "./repository";

describe("ContactRpcHandlers", () => {
  type Fixture = { membershipId: string; organizationId: string; userId: string };

  const makeSession = (fixture: Fixture, isMember = true): Session => ({
    user: { id: fixture.userId, email: "user@example.com", name: "Test User", restrictedToOrganizationId: null },
    session: { userId: fixture.userId, token: "test-token" },
    organizations: [{ id: fixture.organizationId }],
    memberships: isMember ? [{ membershipId: fixture.membershipId, organizationId: fixture.organizationId, role: "owner" }] : [],
  });

  const makeFixture = () => Effect.gen(function* () {
    const db = yield* currentDb;
    const organizationId = yield* WorkspaceId.generate;
    const userId = `user_${organizationId}`;
    const membershipId = `membership_${organizationId}`;
    const now = new Date();
    yield* db.insert(schema.organizationTable).values({ id: organizationId, name: "Test organization", slug: organizationId, createdAt: now });
    yield* db.insert(schema.userTable).values({ id: userId, email: `${organizationId}@example.com`, name: "Test User" });
    yield* db.insert(schema.memberTable).values({ id: membershipId, organizationId, userId, role: "owner", createdAt: now });
    return { membershipId, organizationId, userId } satisfies Fixture;
  });

  const TestLayer = Layer.merge(
    ContactRepository.layer.pipe(Layer.provide(Database.PgliteDatabaseLive)),
    Database.PgliteDatabaseLive,
  );

  layer(TestLayer)("handlers", (it) => {
    it.effect("lists contacts for organization members", () => Effect.gen(function* () {
      const db = yield* currentDb;
      const handlers = yield* ContactRpcHandlersEffect;
      const fixture = yield* makeFixture();
      yield* db.insert(schema.contactTable).values({ id: `contact_${fixture.organizationId}`, organizationId: fixture.organizationId, name: "Ada", email: "ada@example.com", createdAt: new Date(), updatedAt: new Date() });

      const contacts = yield* handlers.ContactList({ organizationId: fixture.organizationId }).pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
      expect(contacts).toHaveLength(1);
      expect(contacts[0]).toMatchObject({ name: "Ada", email: "ada@example.com" });
    }));

    it.effect("rejects non-members from listing companies", () => Effect.gen(function* () {
      const handlers = yield* ContactRpcHandlersEffect;
      const fixture = yield* makeFixture();
      const error = yield* Effect.flip(handlers.CompanyList({ organizationId: fixture.organizationId }).pipe(Effect.provideService(CurrentSession, makeSession(fixture, false))));
      expect(error._tag).toBe("PolicyDenied");
    }));
  });
});
