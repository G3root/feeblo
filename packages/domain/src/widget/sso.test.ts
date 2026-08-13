import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as jose from "jose";
import { EntitlementPolicy } from "../entitlement/policies";
import { RateLimitService } from "../rate-limit/service";
import { WorkspaceRepository } from "../workspace/repository";
import {
  createSsoSession,
  SsoRepositoriesLive,
  WIDGET_SSO_ATTEMPT_RATE_LIMIT,
  WIDGET_SSO_SIGN_IN_RATE_LIMIT,
} from "./sso";

const signToken = (payload: jose.JWTPayload, secret: string) =>
  Effect.promise(() =>
    new jose.SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .sign(new TextEncoder().encode(secret))
  );

const futureExp = Math.floor(Date.now() / 1000) + 3600;
const pastExp = Math.floor(Date.now() / 1000) - 3600;

const TestLayer = Layer.mergeAll(
  SsoRepositoriesLive,
  EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer)),
  RateLimitService.layerMemory
).pipe(Layer.provideMerge(Database.PgliteDatabaseLive));

describe("createSsoSession", () => {
  type Fixture = {
    clientIp: string;
    organizationId: string;
    secret: string;
  };

  const makeFixture = (withSecret: boolean, hasAutomaticSso = true) =>
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

      if (hasAutomaticSso) {
        const productId = `prod_sso_${organizationId}`;
        yield* db.insert(schema.productTable).values({
          id: productId,
          name: "Starter monthly",
          isRecurring: true,
          isArchived: false,
          externalOrganizationId: "polar_org",
          visibility: "PUBLIC",
          recurringInterval: "month",
          metadata: { plan: "starter", variant: "monthly" },
        });
        yield* db.insert(schema.subscriptionTable).values({
          id: `sub_sso_${organizationId}`,
          externalId: `sub_ext_sso_${organizationId}`,
          organizationId,
          amount: 4900,
          cancelAtPeriodEnd: false,
          currency: "usd",
          recurringInterval: "month",
          recurringIntervalCount: 1,
          status: "trialing",
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + 86_400_000),
          customerId: `cus_sso_${organizationId}`,
          productId,
        });
      }

      return {
        clientIp: organizationId,
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
          clientIp: fixture.clientIp,
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

    it.effect("rejects automatic SSO for free-plan organizations", () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture(true, false);
        const token = yield* signToken(validPayload(fixture), fixture.secret);

        const error = yield* Effect.flip(
          createSsoSession({
            clientIp: fixture.clientIp,
            organizationId: fixture.organizationId,
            token,
          })
        );
        expect(error.code).toBe("WIDGET_SSO_NOT_ENTITLED");
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
            clientIp: fixture.clientIp,
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
        const { aud: _aud, ...payloadWithoutAud } = validPayload(fixture);
        const token = yield* signToken(payloadWithoutAud, fixture.secret);

        const error = yield* Effect.flip(
          createSsoSession({
            clientIp: fixture.clientIp,
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
          clientIp: fixture.clientIp,
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
            clientIp: fixture.clientIp,
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
            clientIp: fixture.clientIp,
            organizationId: fixture.organizationId,
            token,
          })
        );
        expect(error.code).toBe("INVALID_JWT");
      })
    );

    it.effect("rate limits repeated SSO sign-ins per organization", () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture(true);
        const token = yield* signToken(validPayload(fixture), fixture.secret);

        for (let i = 0; i < WIDGET_SSO_SIGN_IN_RATE_LIMIT.limit; i++) {
          yield* createSsoSession({
            clientIp: `${fixture.clientIp}-${i}`,
            organizationId: fixture.organizationId,
            token,
          });
        }

        const error = yield* Effect.flip(
          createSsoSession({
            clientIp: `${fixture.clientIp}-final`,
            organizationId: fixture.organizationId,
            token,
          })
        );
        expect(error.code).toBe("SSO_RATE_LIMITED");
      })
    );

    it.effect(
      "limits invalid tokens by client without spending an organization limit",
      () =>
        Effect.gen(function* () {
          const fixture = yield* makeFixture(true);
          const validToken = yield* signToken(
            validPayload(fixture),
            fixture.secret
          );

          for (let i = 0; i < WIDGET_SSO_ATTEMPT_RATE_LIMIT.limit; i++) {
            const error = yield* Effect.flip(
              createSsoSession({
                organizationId: fixture.organizationId,
                token: "not-a-jwt",
                clientIp: "198.51.100.24",
              })
            );
            expect(error.code).toBe("INVALID_JWT");
          }

          const limitedError = yield* Effect.flip(
            createSsoSession({
              organizationId: fixture.organizationId,
              token: "not-a-jwt",
              clientIp: "198.51.100.24",
            })
          );
          expect(limitedError.code).toBe("SSO_RATE_LIMITED");

          const result = yield* createSsoSession({
            clientIp: "198.51.100.25",
            organizationId: fixture.organizationId,
            token: validToken,
          });
          expect(result.name).toBe("Ada Lovelace");
        })
    );

    it.effect("fails when no secret has been generated yet", () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture(false);
        const token = yield* signToken(validPayload(fixture), fixture.secret);

        const error = yield* Effect.flip(
          createSsoSession({
            clientIp: fixture.clientIp,
            organizationId: fixture.organizationId,
            token,
          })
        );
        expect(error.code).toBe("ORGANIZATION_HAS_NO_JWT_SECRET");
      })
    );
  });
});
