import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { CurrentSession, type Session } from "../session-middleware";
import { BillingRpcHandlersEffect } from "./handlers";
import { BillingRepository } from "./repository";
import { PolarService } from "./service";

describe("BillingRpcHandlers", () => {
  type Fixture = { membershipId: string; organizationId: string; userId: string };
  const makeSession = (fixture: Fixture, role: Session["memberships"][number]["role"] | null): Session => ({
    user: { id: fixture.userId, email: "user@example.com", name: "Test User", restrictedToOrganizationId: null },
    session: { userId: fixture.userId, token: "test-token" },
    organizations: [{ id: fixture.organizationId }],
    memberships: role ? [{ membershipId: fixture.membershipId, organizationId: fixture.organizationId, role }] : [],
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
  const PolarServiceTest = Layer.succeed(PolarService, {
    client: undefined,
    webhookSecret: Option.none(),
    createCheckout: () => Effect.die("Polar checkout should not be called"),
    createPortal: () => Effect.die("Polar portal should not be called"),
  });
  const TestLayer = Layer.mergeAll(
    BillingRepository.layer,
    PolarServiceTest,
  ).pipe(Layer.provideMerge(Database.PgliteDatabaseLive));

  layer(TestLayer)("handlers", (it) => {
    it.effect("rejects members without billing privileges", () => Effect.gen(function* () {
      const handlers = yield* BillingRpcHandlersEffect;
      const fixture = yield* makeFixture();
      const error = yield* Effect.flip(handlers.BillingCheckout({ organizationId: fixture.organizationId, productId: "product" }).pipe(Effect.provideService(CurrentSession, makeSession(fixture, "member"))));
      expect(error._tag).toBe("PolicyDenied");
    }));
    it.effect("rejects users without an organization membership", () => Effect.gen(function* () {
      const handlers = yield* BillingRpcHandlersEffect;
      const fixture = yield* makeFixture();
      const error = yield* Effect.flip(handlers.BillingPortal({ organizationId: fixture.organizationId }).pipe(Effect.provideService(CurrentSession, makeSession(fixture, null))));
      expect(error._tag).toBe("PolicyDenied");
    }));
  });
});
