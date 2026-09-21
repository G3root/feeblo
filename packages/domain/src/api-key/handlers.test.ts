import { createHash } from "node:crypto";

import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { type LegidOf, WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EntitlementPolicy } from "../entitlement/policies";
import { Auth, CurrentSession, type Session } from "../session-middleware";
import { WorkspaceRepository } from "../workspace/repository";
import { ApiKeyRpcHandlersEffect } from "./handlers";
import { ApiKeyPolicy } from "./policies";
import { ApiKeyRepository } from "./repository";
import type { ApiKeyAuthCreated } from "./schema";

type Plan = "free" | "starter";

type Fixture = {
  membershipId: string;
  organizationId: LegidOf<"WorkspaceId">;
  userId: string;
};

type Role = Session["memberships"][number]["role"];

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

/**
 * Double for the api-key plugin's server API.
 *
 * It returns the shape the plugin returns, so the mapping under test sees what
 * production sees, and it writes nothing: rows are seeded explicitly per test.
 * The plugin's own behavior — hashing at rest, organization ACL enforcement,
 * scope evaluation on verify — is covered by `packages/auth/src/api-key.test.ts`
 * against the real plugin.
 */
const AuthTest = Layer.succeed(Auth, {
  handler: () => new Response(),
  api: {
    getSession: async () => null,
    createApiKey: async ({ body }): Promise<ApiKeyAuthCreated> => ({
      id: "apikey_created",
      name: body.name,
      start: "fbk_ab",
      prefix: "fbk_",
      enabled: true,
      createdAt: new Date("2026-09-18T00:00:00.000Z"),
      lastRequest: null,
      expiresAt: null,
      referenceId: body.organizationId,
      permissions: body.permissions ?? null,
      key: "fbk_plaintext_returned_once",
    }),
    verifyApiKey: async () => ({ valid: false, key: null }),
  },
});

const makeSession = (fixture: Fixture, role: Role): Session => ({
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

describe("ApiKeyRpcHandlers", () => {
  /** Inserts the subscription and product rows that resolve the workspace plan. */
  const setPlan = (organizationId: string, plan: Plan) =>
    Effect.gen(function* () {
      if (plan === "free") {
        // Free is the absence of an active subscription; nothing to insert.
        return;
      }

      const db = yield* currentDb;
      const now = new Date();

      yield* db.insert(schema.productTable).values({
        id: `product_${organizationId}`,
        name: "Starter",
        isRecurring: true,
        isArchived: false,
        externalOrganizationId: "polar-org",
        visibility: "public",
        metadata: { plan: "starter", variant: "monthly" },
      });

      yield* db.insert(schema.subscriptionTable).values({
        id: `subscription_${organizationId}`,
        externalId: `polar_${organizationId}`,
        organizationId,
        amount: 1900,
        cancelAtPeriodEnd: false,
        currency: "usd",
        recurringInterval: "month",
        recurringIntervalCount: 1,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        customerId: `polar_customer_${organizationId}`,
        productId: `product_${organizationId}`,
        createdAt: now,
        updatedAt: now,
      });
    });

  const makeFixture = (plan: Plan, role: Role = "owner") =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const userId = `user_${organizationId}`;
      const membershipId = `membership_${organizationId}`;
      const now = new Date();

      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Test Organization",
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
        role,
        createdAt: now,
      });

      yield* setPlan(organizationId, plan);

      return { membershipId, organizationId, userId } satisfies Fixture;
    });

  /**
   * Seeds a key the way the plugin stores one: the hash of the plaintext in
   * `key`, the identifying characters in `start`, scopes as a JSON string.
   */
  const seedKey = (
    fixture: Fixture,
    options: { id: string; name: string; plaintext: string }
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const now = new Date("2026-09-18T00:00:00.000Z");

      yield* db.insert(schema.apiKeyTable).values({
        id: options.id,
        name: options.name,
        start: options.plaintext.slice(0, 6),
        prefix: "fbk_",
        referenceId: fixture.organizationId,
        key: sha256(options.plaintext),
        enabled: true,
        createdAt: now,
        updatedAt: now,
        permissions: JSON.stringify({ boards: ["read"], posts: ["read"] }),
      });
    });

  const DatabaseLive = Database.PgliteDatabaseLive;
  const WorkspaceRepositoryLive = WorkspaceRepository.layer.pipe(
    Layer.provide(DatabaseLive)
  );
  const EntitlementPolicyLive = EntitlementPolicy.layer.pipe(
    Layer.provide(WorkspaceRepositoryLive),
    Layer.provide(DatabaseLive)
  );

  const TestLayer = Layer.mergeAll(
    DatabaseLive,
    ApiKeyRepository.layer.pipe(Layer.provide(DatabaseLive)),
    ApiKeyPolicy.layer.pipe(
      Layer.provide(EntitlementPolicyLive),
      Layer.provide(DatabaseLive)
    ),
    AuthTest
  );

  layer(TestLayer)("handlers", (it) => {
    it.effect(
      "returns the plaintext once and a scoped summary for an owner",
      () =>
        Effect.gen(function* () {
          const handlers = yield* ApiKeyRpcHandlersEffect;
          const fixture = yield* makeFixture("starter");

          const created = yield* handlers
            .ApiKeyCreate({
              name: "Production",
              organizationId: fixture.organizationId,
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "owner")
              )
            );

          expect(created.key).toBe("fbk_plaintext_returned_once");
          expect(created.summary).toEqual({
            id: "apikey_created",
            name: "Production",
            start: "fbk_ab",
            prefix: "fbk_",
            enabled: true,
            scopes: ["boards.read", "posts.read"],
            createdAt: new Date("2026-09-18T00:00:00.000Z"),
            lastRequest: null,
            expiresAt: null,
          });
        })
    );

    it.effect("refuses creation for a manager, writing nothing", () =>
      Effect.gen(function* () {
        const handlers = yield* ApiKeyRpcHandlersEffect;
        const fixture = yield* makeFixture("starter");

        const error = yield* handlers
          .ApiKeyCreate({
            name: "Production",
            organizationId: fixture.organizationId,
          })
          .pipe(
            Effect.provideService(
              CurrentSession,
              makeSession(fixture, "manager")
            ),
            Effect.flip
          );

        expect(error._tag).toBe("PolicyDenied");

        const db = yield* currentDb;
        expect(yield* db.select().from(schema.apiKeyTable)).toHaveLength(0);
      })
    );

    it.effect("refuses creation on the free plan", () =>
      Effect.gen(function* () {
        const handlers = yield* ApiKeyRpcHandlersEffect;
        const fixture = yield* makeFixture("free");

        const error = yield* handlers
          .ApiKeyCreate({
            name: "Production",
            organizationId: fixture.organizationId,
          })
          .pipe(
            Effect.provideService(
              CurrentSession,
              makeSession(fixture, "owner")
            ),
            Effect.flip
          );

        expect(error._tag).toBe("PolicyDenied");
      })
    );

    it.effect("still lists and revokes keys after a downgrade", () =>
      Effect.gen(function* () {
        const handlers = yield* ApiKeyRpcHandlersEffect;
        const fixture = yield* makeFixture("starter");
        yield* seedKey(fixture, {
          id: "apikey_downgraded",
          name: "Production",
          plaintext: "fbk_downgraded",
        });

        // Downgrade: the active subscription disappears.
        const db = yield* currentDb;
        yield* db.delete(schema.subscriptionTable);

        const keys = yield* handlers
          .ApiKeyList({ organizationId: fixture.organizationId })
          .pipe(
            Effect.provideService(CurrentSession, makeSession(fixture, "owner"))
          );
        expect(keys).toHaveLength(1);
        expect(keys[0]).toMatchObject({
          id: "apikey_downgraded",
          scopes: ["boards.read", "posts.read"],
        });

        yield* handlers
          .ApiKeyRevoke({
            organizationId: fixture.organizationId,
            keyId: "apikey_downgraded",
          })
          .pipe(
            Effect.provideService(CurrentSession, makeSession(fixture, "owner"))
          );

        expect(yield* db.select().from(schema.apiKeyTable)).toHaveLength(0);
      })
    );

    it.effect("lists only the caller's own keys", () =>
      Effect.gen(function* () {
        const handlers = yield* ApiKeyRpcHandlersEffect;
        const mine = yield* makeFixture("starter");
        const theirs = yield* makeFixture("starter");

        yield* seedKey(mine, {
          id: "apikey_mine",
          name: "Mine",
          plaintext: "fbk_mine",
        });
        yield* seedKey(theirs, {
          id: "apikey_theirs",
          name: "Theirs",
          plaintext: "fbk_theirs",
        });

        const keys = yield* handlers
          .ApiKeyList({ organizationId: mine.organizationId })
          .pipe(
            Effect.provideService(CurrentSession, makeSession(mine, "owner"))
          );

        expect(keys.map((key) => key.id)).toEqual(["apikey_mine"]);
      })
    );

    it.effect("cannot revoke another workspace's key", () =>
      Effect.gen(function* () {
        const handlers = yield* ApiKeyRpcHandlersEffect;
        const mine = yield* makeFixture("starter");
        const theirs = yield* makeFixture("starter");

        yield* seedKey(theirs, {
          id: "apikey_theirs_revoke",
          name: "Theirs",
          plaintext: "fbk_theirs_revoke",
        });

        const error = yield* handlers
          .ApiKeyRevoke({
            organizationId: mine.organizationId,
            keyId: "apikey_theirs_revoke",
          })
          .pipe(
            Effect.provideService(CurrentSession, makeSession(mine, "owner")),
            Effect.flip
          );

        expect(error._tag).toBe("NotFoundError");

        const db = yield* currentDb;
        const rows = yield* db
          .select()
          .from(schema.apiKeyTable)
          .where(eq(schema.apiKeyTable.id, "apikey_theirs_revoke"));
        expect(rows).toHaveLength(1);
        expect(rows[0]?.referenceId).toBe(theirs.organizationId);
      })
    );

    it.effect(
      "refuses to manage keys without a membership in the workspace",
      () =>
        Effect.gen(function* () {
          const handlers = yield* ApiKeyRpcHandlersEffect;
          const fixture = yield* makeFixture("starter");

          const error = yield* handlers
            .ApiKeyList({ organizationId: fixture.organizationId })
            .pipe(
              Effect.provideService(CurrentSession, {
                ...makeSession(fixture, "owner"),
                memberships: [],
                organizations: [],
              }),
              Effect.flip
            );

          expect(error._tag).toBe("PolicyDenied");
        })
    );
  });
});
