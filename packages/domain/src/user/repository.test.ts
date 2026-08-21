import { createHash } from "node:crypto";

import { NodeCrypto } from "@effect/platform-node";
import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { UserRepository } from "./repository";

describe("UserRepository", () => {
  const TestLayer = Layer.mergeAll(
    UserRepository.layer.pipe(Layer.provide(Database.PgliteDatabaseLive)),
    Database.PgliteDatabaseLive,
    NodeCrypto.layer
  );

  layer(TestLayer)("upsertSsoUser", (it) => {
    it.effect("never returns an existing global account matched by email", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const repository = yield* UserRepository;

        yield* db.insert(schema.userTable).values({
          id: "user_real",
          name: "Real User",
          email: "victim@example.com",
          emailHash: createHash("sha256")
            .update("victim@example.com")
            .digest("hex"),
          emailVerified: true,
        });

        const ssoUser = yield* repository.upsertSsoUser({
          email: "victim@example.com",
          name: "SSO User",
          restrictedToOrganizationId: "org-a",
        });

        expect(ssoUser.id).not.toBe("user_real");
        expect(ssoUser.email).not.toBe("victim@example.com");
        expect(ssoUser.restrictedToOrganizationId).toBe("org-a");
      })
    );

    it.effect("updates the same SSO user for the same organization", () =>
      Effect.gen(function* () {
        const repository = yield* UserRepository;

        const first = yield* repository.upsertSsoUser({
          email: "widget@example.com",
          name: "First",
          restrictedToOrganizationId: "org-a",
        });
        const second = yield* repository.upsertSsoUser({
          email: "widget@example.com",
          name: "Second",
          restrictedToOrganizationId: "org-a",
        });

        expect(second.id).toBe(first.id);
        expect(second.name).toBe("Second");
      })
    );

    it.effect(
      "does not re-scope an SSO user claimed by another organization",
      () =>
        Effect.gen(function* () {
          const repository = yield* UserRepository;

          const orgA = yield* repository.upsertSsoUser({
            email: "widget@example.com",
            name: "Org A",
            restrictedToOrganizationId: "org-a",
          });
          const orgB = yield* repository.upsertSsoUser({
            email: "widget@example.com",
            name: "Org B",
            restrictedToOrganizationId: "org-b",
          });

          expect(orgB.id).not.toBe(orgA.id);
          expect(orgA.restrictedToOrganizationId).toBe("org-a");
          expect(orgB.restrictedToOrganizationId).toBe("org-b");
        })
    );
  });

  layer(TestLayer)("provisionShadowUser", (it) => {
    it.effect("creates an attribution-only user that cannot authenticate", () =>
      Effect.gen(function* () {
        const repository = yield* UserRepository;

        const shadow = yield* repository.provisionShadowUser({
          email: "jane@example.com",
          name: "Jane Doe",
          restrictedToOrganizationId: "org-a",
        });

        expect(shadow.email).toMatch(/^behalf-[0-9a-f]{16}@feeblo\.com$/);
        expect(shadow.emailVerified).toBe(false);
        expect(shadow.restrictedToOrganizationId).toBe("org-a");
        expect(shadow.jwtAutoLoginAt).toBeNull();
        expect(shadow.name).toBe("Jane Doe");
      })
    );

    it.effect("never returns an existing global account matched by email", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const repository = yield* UserRepository;

        yield* db.insert(schema.userTable).values({
          id: "user_global_member",
          name: "Real User",
          email: "member@example.com",
          emailHash: createHash("sha256")
            .update("member@example.com")
            .digest("hex"),
          emailVerified: true,
        });

        const shadow = yield* repository.provisionShadowUser({
          email: "member@example.com",
          name: "Shadow",
          restrictedToOrganizationId: "org-a",
        });

        expect(shadow.id).not.toBe("user_global_member");
        expect(shadow.email).toMatch(/^behalf-/);
      })
    );

    it.effect("reuses the same shadow for the same organization", () =>
      Effect.gen(function* () {
        const repository = yield* UserRepository;

        const first = yield* repository.provisionShadowUser({
          email: "jane@example.com",
          name: "First",
          restrictedToOrganizationId: "org-a",
        });
        const second = yield* repository.provisionShadowUser({
          email: "jane@example.com",
          name: "Second",
          restrictedToOrganizationId: "org-a",
        });

        expect(second.id).toBe(first.id);
        expect(second.name).toBe("Second");
        expect(second.emailVerified).toBe(false);
      })
    );

    it.effect("does not claim a shadow owned by another organization", () =>
      Effect.gen(function* () {
        const repository = yield* UserRepository;

        const orgA = yield* repository.provisionShadowUser({
          email: "jane@example.com",
          name: "Org A",
          restrictedToOrganizationId: "org-a",
        });
        const orgB = yield* repository.provisionShadowUser({
          email: "jane@example.com",
          name: "Org B",
          restrictedToOrganizationId: "org-b",
        });

        expect(orgB.id).not.toBe(orgA.id);
        expect(orgA.restrictedToOrganizationId).toBe("org-a");
        expect(orgB.restrictedToOrganizationId).toBe("org-b");
      })
    );

    it.effect(
      "adopts an existing SSO portal user for the same email and organization without changing their verification state",
      () =>
        Effect.gen(function* () {
          const repository = yield* UserRepository;

          const ssoUser = yield* repository.upsertSsoUser({
            email: "portal@example.com",
            name: "Portal User",
            restrictedToOrganizationId: "org-a",
          });

          const adopted = yield* repository.provisionShadowUser({
            email: "portal@example.com",
            name: "Portal User",
            restrictedToOrganizationId: "org-a",
          });

          expect(adopted.id).toBe(ssoUser.id);
          expect(adopted.emailVerified).toBe(true);
        })
    );
  });
});
