import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as jose from "jose";
import { createSsoSession, SsoRepositoriesLive } from "./sso";

const signToken = (payload: jose.JWTPayload, secret: string) =>
  Effect.promise(() =>
    new jose.SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .sign(new TextEncoder().encode(secret))
  );

const futureExp = Math.floor(Date.now() / 1000) + 3600;
const pastExp = Math.floor(Date.now() / 1000) - 3600;

const TestLayer = SsoRepositoriesLive.pipe(
  Layer.provideMerge(Database.PgliteDatabaseLive)
);

describe("createSsoSession", () => {
  type Fixture = {
    organizationId: string;
    secret: string;
  };

  const makeFixture = (withSecret: boolean) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const now = new Date();

      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Test organization",
        slug: organizationId,
        createdAt: now,
      });

      if (withSecret) {
        yield* db.insert(schema.jwtSecretTable).values({
          id: `jwt_secret_${organizationId}`,
          organizationId,
          secret: `secret-${organizationId}`,
          createdAt: now,
          revokedAt: null,
        });
      }

      return {
        organizationId,
        secret: `secret-${organizationId}`,
      } satisfies Fixture;
    });

  const validPayload = (fixture: Fixture) => ({
    aud: fixture.organizationId,
    exp: futureExp,
    userId: "external_user_1",
    email: "ada@example.com",
    name: "Ada Lovelace",
  });

  layer(TestLayer)("token contract", (it) => {
    it.effect("creates a restricted SSO user for a valid org-bound token", () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture(true);
        const token = yield* signToken(validPayload(fixture), fixture.secret);

        const result = yield* createSsoSession({
          organizationId: fixture.organizationId,
          token,
        });

        // The stored SSO user email is randomized by design (identity lives
        // on the linked contact); only name + userId carry through.
        expect(result.name).toBe("Ada Lovelace");

        const db = yield* currentDb;
        const [user] = yield* db
          .select()
          .from(schema.userTable)
          .where(eq(schema.userTable.id, result.userId));
        expect(user?.restrictedToOrganizationId).toBe(fixture.organizationId);

        // The token's real identity lands on the linked contact.
        const [contact] = yield* db
          .select()
          .from(schema.contactTable)
          .where(eq(schema.contactTable.email, "ada@example.com"));
        expect(contact?.email).toBe("ada@example.com");
        expect(contact?.userId).toBe(result.userId);
      })
    );

    it.effect("rejects a token bound to a different organization", () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture(true);
        const token = yield* signToken(
          {
            ...validPayload(fixture),
            aud: "org_other",
          },
          fixture.secret
        );

        const error = yield* Effect.flip(
          createSsoSession({
            organizationId: fixture.organizationId,
            token,
          })
        );
        expect(error.code).toBe("INVALID_JWT");
      })
    );

    it.effect("rejects a token without an aud claim", () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture(true);
        const token = yield* signToken(
          {
            exp: futureExp,
            userId: "external_user_1",
            email: "ada@example.com",
            name: "Ada Lovelace",
          },
          fixture.secret
        );

        const error = yield* Effect.flip(
          createSsoSession({
            organizationId: fixture.organizationId,
            token,
          })
        );
        expect(error.code).toBe("INVALID_JWT");
      })
    );

    it.effect("accepts a token without an exp claim (exp is optional)", () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture(true);
        const { exp: _exp, ...payloadWithoutExp } = validPayload(fixture);
        const token = yield* signToken(payloadWithoutExp, fixture.secret);

        const result = yield* createSsoSession({
          organizationId: fixture.organizationId,
          token,
        });

        expect(result.name).toBe("Ada Lovelace");
      })
    );

    it.effect("rejects an expired token when exp is present", () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture(true);
        const token = yield* signToken(
          {
            ...validPayload(fixture),
            exp: pastExp,
          },
          fixture.secret
        );

        const error = yield* Effect.flip(
          createSsoSession({
            organizationId: fixture.organizationId,
            token,
          })
        );
        expect(error.code).toBe("INVALID_JWT");
      })
    );

    it.effect("rejects a token signed with another organization's secret", () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture(true);
        const token = yield* signToken(
          validPayload(fixture),
          "a-different-orgs-secret"
        );

        const error = yield* Effect.flip(
          createSsoSession({
            organizationId: fixture.organizationId,
            token,
          })
        );
        expect(error.code).toBe("INVALID_JWT");
      })
    );

    it.effect("fails when no secret has been generated yet", () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture(false);
        const token = yield* signToken(validPayload(fixture), fixture.secret);

        const error = yield* Effect.flip(
          createSsoSession({
            organizationId: fixture.organizationId,
            token,
          })
        );
        expect(error.code).toBe("ORGANIZATION_HAS_NO_JWT_SECRET");
      })
    );
  });
});
