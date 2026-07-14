import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { ChangelogId, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { EntitlementPolicy } from "../entitlement/policies";
import { CurrentSession, type Session } from "../session-middleware";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { ChangelogRpcHandlersEffect } from "./handlers";
import { ChangelogPolicy } from "./policies";
import { ChangelogRepository } from "./repository";

describe("ChangelogRpcHandlers", () => {
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
  const Repositories = Layer.mergeAll(
    ChangelogRepository.layer,
    SiteRepository.layer,
    WorkspaceRepository.layer,
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));
  const Entitlements = EntitlementPolicy.layer.pipe(
    Layer.provide(Repositories),
  );
  const Policies = Layer.mergeAll(
    ChangelogPolicy.layer,
    SitePolicy.layer,
  ).pipe(Layer.provide(Entitlements), Layer.provide(Repositories));
  const TestLayer = Layer.mergeAll(
    Repositories,
    Entitlements,
    Policies,
    Database.PgliteDatabaseLive,
  );

  layer(TestLayer)("handlers", (it) => {
    it.effect("creates sanitized changelog entries for members", () => Effect.gen(function* () {
      const handlers = yield* ChangelogRpcHandlersEffect;
      const fixture = yield* makeFixture();
      const id = yield* ChangelogId.generate;
      yield* handlers.ChangelogCreate({ id, organizationId: fixture.organizationId, title: "Release", slug: "", content: "Safe\n\n<script>alert(1)</script>", status: "draft", scheduledAt: null, publishedAt: null }).pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
      const entries = yield* handlers.ChangelogList({ organizationId: fixture.organizationId }).pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
      expect(entries[0]).toMatchObject({ id, slug: "release", content: "Safe\n", creatorMemberId: fixture.membershipId });
    }));
    it.effect("rejects non-members from listing changelog entries", () => Effect.gen(function* () {
      const handlers = yield* ChangelogRpcHandlersEffect;
      const fixture = yield* makeFixture();
      const error = yield* Effect.flip(handlers.ChangelogList({ organizationId: fixture.organizationId }).pipe(Effect.provideService(CurrentSession, makeSession(fixture, false))));
      expect(error._tag).toBe("PolicyDenied");
    }));
  });
});
