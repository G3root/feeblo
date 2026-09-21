import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defaultKeyHasher } from "@better-auth/api-key";
import { Database } from "@feeblo/db";
import { migratePglite } from "@feeblo/db/pglite";
import * as schema from "@feeblo/db/schema";
import { EntitlementPolicy } from "@feeblo/domain/entitlement/policies";
import { WorkspaceRepository } from "@feeblo/domain/workspace/repository";
import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { parseSetCookieHeader } from "better-auth/cookies";
import { organization } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import type * as Config from "effect/Config";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import type * as SqlError from "effect/unstable/sql/SqlError";
import { afterAll, describe, expect, it } from "vitest";

import { drizzleAdapter } from "./adapter/drizzle-adapter";
import { enforcePublicApiKeyPlan, publicApiKeyPlugin } from "./api-key-config";
import {
  ORGANIZATION_ROLES,
  organizationAccessControl,
} from "./organization-roles";
import { mapPolicyDeniedToApiError } from "./policy-api-error";

/**
 * Integration test for the api-key plugin wiring: the real plugin, the real
 * better-auth organization ACL, the real adapter, on PGlite.
 *
 * It exists because the plugin authorizes every organization-owned key
 * operation against this package's organization ACL — it evaluates
 * `hasPermission({ permissions: { apiKey: [action] } })` on the acting member's
 * role. A role without the `apiKey` statement cannot mint a credential, and
 * better-auth's `allowCreatorAllPermissions` would mask a missing grant for the
 * organization creator, so the happy path here is exercised as an **admin**
 * (not the creator) and the denial path as a **manager**.
 */
const databaseDirectory = mkdtempSync(join(tmpdir(), "feeblo-auth-apikey-"));

// Setup runs at module scope rather than in a hook: applying the migration set
// takes seconds on its own and can exceed vitest's default hook timeout when
// the whole workspace runs its tests in parallel.
process.env.DATABASE_URL = `pglite:${databaseDirectory}`;
await migratePglite(process.env.DATABASE_URL);

const runtime: ManagedRuntime.ManagedRuntime<
  Database.Database,
  SqlError.SqlError | Config.ConfigError
> = ManagedRuntime.make(Database.PgliteDatabaseLive);
const db = await runtime.runPromise(Database.Database);

/**
 * Runs the real `EntitlementPolicy.canUsePublicApi` check against the same
 * PGlite database, so the plan gate under test exercises the policy production
 * wires into the auth hook rather than a stub of it.
 */
const entitlementRuntime = ManagedRuntime.make(
  EntitlementPolicy.layer.pipe(
    Layer.provide(WorkspaceRepository.layer),
    Layer.provide(Layer.succeed(Database.Database, db))
  )
);

const assertPublicApiEntitled = async (organizationId: string) => {
  try {
    await entitlementRuntime.runPromise(
      EntitlementPolicy.use((policy) => policy.canUsePublicApi(organizationId))
    );
  } catch (error) {
    throw mapPolicyDeniedToApiError(error);
  }
};

/**
 * Extracts the session cookie from a better-auth response so an HTTP request
 * can present it. The name is matched by suffix because a secure prefix may be
 * applied depending on the base URL.
 */
const sessionCookieFrom = (headers: Headers): string => {
  const cookies = parseSetCookieHeader(headers.get("set-cookie") ?? "");
  const entry = [...cookies].find(([name]) => name.endsWith("session_token"));
  return entry === undefined ? "" : `${entry[0]}=${entry[1].value}`;
};

afterAll(async () => {
  await entitlementRuntime.dispose();
  await runtime.dispose();
  rmSync(databaseDirectory, { force: true, recursive: true });
});

describe("api-key plugin wiring", () => {
  const makeAuth = () =>
    betterAuth({
      database: drizzleAdapter(db, {
        provider: "pg",
        schema: {
          user: schema.userTable,
          session: schema.sessionTable,
          account: schema.accountTable,
          verification: schema.verificationTable,
          organization: schema.organizationTable,
          member: schema.memberTable,
          invitation: schema.invitationTable,
          apikey: schema.apiKeyTable,
        },
      }),
      baseURL: "http://localhost:3000",
      secret: "test-secret-that-is-long-enough-for-better-auth",
      emailAndPassword: { enabled: true },
      telemetry: { enabled: false },
      trustedOrigins: ["http://localhost:3000"],
      hooks: {
        before: createAuthMiddleware((ctx) =>
          enforcePublicApiKeyPlan(ctx, assertPublicApiEntitled)
        ),
      },
      plugins: [
        organization({
          allowUserToCreateOrganization: false,
          ac: organizationAccessControl,
          roles: ORGANIZATION_ROLES,
        }),
        // The shipping plugin configuration, so this test covers what runs.
        publicApiKeyPlugin,
      ],
    });

  let fixtureSequence = 0;

  /** Inserts the subscription and product rows that resolve the workspace plan. */
  const seedPlan = async (organizationId: string, plan: "free" | "starter") => {
    if (plan === "free") {
      // Free is the absence of an active subscription; nothing to insert.
      return;
    }

    const now = new Date();
    await runtime.runPromise(
      db.insert(schema.productTable).values({
        id: `product_${organizationId}`,
        name: "Starter",
        isRecurring: true,
        isArchived: false,
        externalOrganizationId: "polar-org",
        visibility: "public",
        metadata: { plan: "starter", variant: "monthly" },
      })
    );
    await runtime.runPromise(
      db.insert(schema.subscriptionTable).values({
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
      })
    );
  };

  const seedOrganization = async (label: string) => {
    fixtureSequence += 1;
    const organizationId = `org_${label}_${fixtureSequence}`;
    const now = new Date();

    await runtime.runPromise(
      db.insert(schema.organizationTable).values({
        id: organizationId,
        name: `Org ${label} ${fixtureSequence}`,
        slug: `org-${label}-${fixtureSequence}`,
        createdAt: now,
      })
    );

    return organizationId;
  };

  const seedMember = async (
    role: "owner" | "admin" | "manager",
    plan: "free" | "starter" = "starter"
  ) => {
    fixtureSequence += 1;
    const organizationId = `org_${role}_${fixtureSequence}`;
    const userId = `user_${role}_${fixtureSequence}`;
    const membershipId = `membership_${role}_${fixtureSequence}`;
    const now = new Date();

    await runtime.runPromise(
      db.insert(schema.organizationTable).values({
        id: organizationId,
        name: `Org ${role}`,
        slug: `org-${role}-${fixtureSequence}`,
        createdAt: now,
      })
    );
    await runtime.runPromise(
      db.insert(schema.userTable).values({
        id: userId,
        email: `${role}${fixtureSequence}@example.com`,
        name: `Test ${role}`,
      })
    );
    await runtime.runPromise(
      db.insert(schema.memberTable).values({
        id: membershipId,
        organizationId,
        userId,
        role,
        createdAt: now,
      })
    );

    await seedPlan(organizationId, plan);

    return { membershipId, organizationId, userId };
  };

  const keysFor = (organizationId: string) =>
    runtime.runPromise(
      db
        .select()
        .from(schema.apiKeyTable)
        .where(eq(schema.apiKeyTable.referenceId, organizationId))
    );

  /**
   * Signs a user up through better-auth, joins them to the workspace, then
   * posts the plugin's mounted create route with that session cookie. This is
   * the HTTP path a member could call directly, so it exercises the plan gate
   * on the route rather than only the server-side `auth.api.createApiKey`
   * entry point.
   */
  const createApiKeyOverHttp = async (
    auth: ReturnType<typeof makeAuth>,
    options: {
      readonly email: string;
      readonly organizationId: string;
      /** Raw JSON value for the body field, so coercion can be exercised. */
      readonly organizationIdBody?: unknown;
      readonly role: "owner" | "admin";
    }
  ) => {
    const signUp = await auth.api.signUpEmail({
      body: {
        email: options.email,
        password: "password-1234",
        name: "HTTP User",
      },
      returnHeaders: true,
    });

    await runtime.runPromise(
      db.insert(schema.memberTable).values({
        id: `membership_${options.organizationId}`,
        organizationId: options.organizationId,
        userId: signUp.response.user.id,
        role: options.role,
        createdAt: new Date(),
      })
    );

    return auth.handler(
      new Request("http://localhost:3000/api/auth/api-key/create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookieFrom(signUp.headers),
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          organizationId: options.organizationIdBody ?? options.organizationId,
          name: "Production",
        }),
      })
    );
  };

  const perTestTimeout = 30_000;

  it(
    "lets an admin create a key, and stores only a hash of it",
    async () => {
      const auth = makeAuth();
      const { organizationId, userId } = await seedMember("admin");

      const created = await auth.api.createApiKey({
        body: {
          organizationId,
          userId,
          name: "Production",
          permissions: { boards: ["read"], posts: ["read"] },
        },
      });

      expect(created.key).toMatch(/^fbk_/);
      expect(created.referenceId).toBe(organizationId);
      // The stored prefix is what the dashboard shows to identify the key.
      expect(created.start).toBe(created.key.slice(0, 6));

      const rows = await keysFor(organizationId);
      const stored = rows.at(0);
      expect(rows).toHaveLength(1);
      // The plugin stores a base64url SHA-256 digest: never the plaintext.
      expect(stored?.key).toBe(await defaultKeyHasher(created.key));
      expect(stored?.key).not.toBe(created.key);
      expect(stored?.permissions).toContain("posts");
      expect(stored?.rateLimitEnabled).toBe(false);
    },
    perTestTimeout
  );

  it(
    "verifies a live key, rejects a scope it does not hold, and rejects it after revocation",
    async () => {
      const auth = makeAuth();
      const { organizationId, userId } = await seedMember("admin");

      const created = await auth.api.createApiKey({
        body: {
          organizationId,
          userId,
          name: "Production",
          permissions: { boards: ["read"], posts: ["read"] },
        },
      });

      const verified = await auth.api.verifyApiKey({
        body: { key: created.key },
      });
      expect(verified.valid).toBe(true);

      const wrongScope = await auth.api.verifyApiKey({
        body: { key: created.key, permissions: { posts: ["write"] } },
      });
      expect(wrongScope.valid).toBe(false);

      const garbage = await auth.api.verifyApiKey({
        body: { key: "fbk_nope" },
      });
      expect(garbage.valid).toBe(false);

      // Revocation is a row delete — what `ApiKeyRepository.revoke` performs —
      // and it must take effect on the next verification.
      await runtime.runPromise(
        db
          .delete(schema.apiKeyTable)
          .where(eq(schema.apiKeyTable.id, created.id))
      );

      const revoked = await auth.api.verifyApiKey({
        body: { key: created.key },
      });
      expect(revoked.valid).toBe(false);
    },
    perTestTimeout
  );

  it(
    "denies key creation for a manager, writing nothing",
    async () => {
      const auth = makeAuth();
      const { organizationId, userId } = await seedMember("manager");

      let denied = false;
      try {
        await auth.api.createApiKey({
          body: { organizationId, userId, name: "Production" },
        });
      } catch {
        denied = true;
      }

      expect(denied).toBe(true);
      expect(await keysFor(organizationId)).toHaveLength(0);
    },
    perTestTimeout
  );

  it(
    "lets the organization creator (owner) create a key",
    async () => {
      const auth = makeAuth();
      const { organizationId, userId } = await seedMember("owner");

      const created = await auth.api.createApiKey({
        body: { organizationId, userId, name: "Owner key" },
      });

      expect(created.referenceId).toBe(organizationId);
      expect(created.permissions).toEqual({
        boards: ["read"],
        posts: ["read"],
      });
    },
    perTestTimeout
  );

  it(
    "refuses direct HTTP key creation for a free workspace",
    async () => {
      const auth = makeAuth();
      const organizationId = await seedOrganization("free_http");

      const response = await createApiKeyOverHttp(auth, {
        email: `free-http-${organizationId}@example.com`,
        organizationId,
        role: "owner",
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        message: expect.stringContaining("Starter plan"),
      });
      // The gate runs before the plugin writes anything.
      expect(await keysFor(organizationId)).toHaveLength(0);
    },
    perTestTimeout
  );

  it(
    "refuses a coerced organization id for a free workspace",
    async () => {
      const auth = makeAuth();
      const organizationId = await seedOrganization("coerced_http");

      // The endpoint's body schema coerces this array to the real id via
      // `z.coerce.string()`; the plan gate must apply before that happens.
      const response = await createApiKeyOverHttp(auth, {
        email: `coerced-http-${organizationId}@example.com`,
        organizationId,
        organizationIdBody: [organizationId],
        role: "owner",
      });

      expect(response.status).toBe(403);
      expect(await keysFor(organizationId)).toHaveLength(0);
    },
    perTestTimeout
  );

  it(
    "lets a paid workspace create a key over HTTP",
    async () => {
      const auth = makeAuth();
      const organizationId = await seedOrganization("paid_http");
      await seedPlan(organizationId, "starter");

      const response = await createApiKeyOverHttp(auth, {
        email: `paid-http-${organizationId}@example.com`,
        organizationId,
        role: "admin",
      });

      expect(response.status).toBe(200);
      expect(await keysFor(organizationId)).toHaveLength(1);
    },
    perTestTimeout
  );
});
