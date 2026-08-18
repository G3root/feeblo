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
});
