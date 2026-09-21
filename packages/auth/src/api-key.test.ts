import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defaultKeyHasher } from "@better-auth/api-key";
import { Database, currentDb } from "@feeblo/db";
import { migratePglite } from "@feeblo/db/pglite";
import * as schema from "@feeblo/db/schema";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import type * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import type * as SqlError from "effect/unstable/sql/SqlError";
import { afterAll, describe, expect, it } from "vitest";

import { drizzleAdapter } from "./adapter/drizzle-adapter";
import { publicApiKeyPlugin } from "./api-key-config";
import {
  ORGANIZATION_ROLES,
  organizationAccessControl,
} from "./organization-roles";

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
const db: Effect.Success<typeof currentDb> =
  await runtime.runPromise(currentDb);

afterAll(async () => {
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
      emailAndPassword: { enabled: false },
      telemetry: { enabled: false },
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

  const seedMember = async (role: "owner" | "admin" | "manager") => {
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

    return { membershipId, organizationId, userId };
  };

  const keysFor = (organizationId: string) =>
    runtime.runPromise(
      db
        .select()
        .from(schema.apiKeyTable)
        .where(eq(schema.apiKeyTable.referenceId, organizationId))
    );

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
});
