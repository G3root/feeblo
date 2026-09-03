import { createHash } from "node:crypto";

import { NodeCrypto } from "@effect/platform-node";
import { describe, expect, it, layer } from "@effect/vitest";
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
  linkAnonymousAccount,
  SsoRepositoriesLive,
  WIDGET_SSO_ATTEMPT_RATE_LIMIT,
  WIDGET_SSO_SIGN_IN_RATE_LIMIT,
} from "./sso";

const signToken = (payload: jose.JWTPayload, secret: string) =>
  Effect.promise(() =>
    new jose.SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .sign(new Uint8Array(Buffer.from(secret, "hex")))
  );

const hashEmail = (email: string): string =>
  createHash("sha256").update(email.toLowerCase().trim()).digest("hex");

const futureExp = Math.floor(Date.now() / 1000) + 3600;
const pastExp = Math.floor(Date.now() / 1000) - 3600;

const TestLayer = Layer.mergeAll(
  SsoRepositoriesLive,
  EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer)),
  NodeCrypto.layer,
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
          secret: "a".repeat(64),
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
        secret: "a".repeat(64),
      } satisfies Fixture;
    });

  const validPayload = (fixture: Fixture) => ({
    aud: fixture.organizationId,
    exp: futureExp,
    iat: Math.floor(Date.now() / 1000),
    sub: "external_user_1",
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

    it.effect("rejects a token without an exp claim (exp is required)", () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture(true);
        const { exp: _exp, ...payloadWithoutExp } = validPayload(fixture);
        const token = yield* signToken(payloadWithoutExp, fixture.secret);

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

    it.effect(
      "rejects a token claiming a lifetime beyond the 24h default cap",
      () =>
        Effect.gen(function* () {
          const fixture = yield* makeFixture(true);
          const token = yield* signToken(
            {
              ...validPayload(fixture),
              iat: Math.floor(Date.now() / 1000),
              exp: Math.floor(Date.now() / 1000) + 25 * 3600,
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

    it.effect("enforces a tightened per-organization lifetime cap", () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture(true);
        const db = yield* currentDb;
        yield* db
          .update(schema.organizationTable)
          .set({ jwtMaxTokenLifetimeMinutes: 60 }) // 1 hour
          .where(eq(schema.organizationTable.id, fixture.organizationId));

        // 2-hour lifetime: fine under the 24h default, too long for this org.
        const token = yield* signToken(
          {
            ...validPayload(fixture),
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 2 * 3600,
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

    it.effect(
      "accepts a token within a tightened per-organization lifetime cap",
      () =>
        Effect.gen(function* () {
          const fixture = yield* makeFixture(true);
          const db = yield* currentDb;
          yield* db
            .update(schema.organizationTable)
            .set({ jwtMaxTokenLifetimeMinutes: 60 })
            .where(eq(schema.organizationTable.id, fixture.organizationId));

          const token = yield* signToken(
            {
              ...validPayload(fixture),
              iat: Math.floor(Date.now() / 1000),
              exp: Math.floor(Date.now() / 1000) + 30 * 60,
            },
            fixture.secret
          );

          const result = yield* createSsoSession({
            clientIp: fixture.clientIp,
            organizationId: fixture.organizationId,
            token,
          });
          expect(result.name).toBe("Ada Lovelace");
        })
    );

    it.effect("rejects a token signed with another organization's secret", () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture(true);
        const token = yield* signToken(validPayload(fixture), "b".repeat(64));

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

  layer(TestLayer)("shadow adoption", (it) => {
    it.effect(
      "promotes a matched behalf-* shadow into a clean verified SSO identity",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const fixture = yield* makeFixture(true);
          const now = new Date();

          // An admin recorded this customer on behalf before they ever used
          // the widget portal: contact + shadow user already exist.
          yield* db.insert(schema.userTable).values({
            id: "user_shadow",
            name: "Ada Lovelace",
            email: "behalf-0a1b2c3d4e5f6a7b@feeblo.com",
            emailHash: hashEmail("ada@example.com"),
            emailVerified: false,
            restrictedToOrganizationId: fixture.organizationId,
          });
          const boardId = `board_${fixture.organizationId}`;
          const statusId = `status_${fixture.organizationId}`;
          yield* db.insert(schema.boardTable).values({
            id: boardId,
            name: "Board",
            slug: boardId,
            visibility: "PUBLIC",
            organizationId: fixture.organizationId,
            createdAt: now,
            updatedAt: now,
          });
          yield* db.insert(schema.postStatusTable).values({
            id: statusId,
            type: "PENDING",
            orderIndex: 0,
            organizationId: fixture.organizationId,
          });
          yield* db.insert(schema.postTable).values({
            id: "post_on_behalf",
            title: "On-behalf post",
            slug: "post-on-behalf",
            content: "Content",
            boardId,
            statusId,
            organizationId: fixture.organizationId,
            creatorId: "user_shadow",
            createdAt: now,
            updatedAt: now,
          });
          yield* db.insert(schema.contactTable).values({
            id: "contact_ada",
            organizationId: fixture.organizationId,
            email: "ada@example.com",
            name: "Ada Lovelace",
            userId: "user_shadow",
            createdAt: now,
            updatedAt: now,
          });

          const token = yield* signToken(validPayload(fixture), fixture.secret);
          const result = yield* createSsoSession({
            clientIp: fixture.clientIp,
            organizationId: fixture.organizationId,
            token,
          });

          // The portal session lands on the same (now clean) identity.
          expect(result.userId).toBe("user_shadow");
          const [user] = yield* db
            .select()
            .from(schema.userTable)
            .where(eq(schema.userTable.id, result.userId));
          expect(user?.email).toMatch(/^sso-[0-9a-f]{16}@feeblo\.com$/);
          expect(user?.emailVerified).toBe(true);
          expect(user?.restrictedToOrganizationId).toBe(fixture.organizationId);

          // Attributed data stays attached to the healed identity.
          const [contact] = yield* db
            .select()
            .from(schema.contactTable)
            .where(eq(schema.contactTable.id, "contact_ada"));
          expect(contact?.userId).toBe("user_shadow");
          const [post] = yield* db
            .select()
            .from(schema.postTable)
            .where(eq(schema.postTable.id, "post_on_behalf"));
          expect(post?.creatorId).toBe("user_shadow");
        })
    );

    it.effect("leaves native SSO users untouched when they sign in again", () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture(true);
        const token = yield* signToken(validPayload(fixture), fixture.secret);

        const first = yield* createSsoSession({
          clientIp: fixture.clientIp,
          organizationId: fixture.organizationId,
          token,
        });
        const second = yield* createSsoSession({
          clientIp: `${fixture.clientIp}-2`,
          organizationId: fixture.organizationId,
          token,
        });

        expect(second.userId).toBe(first.userId);
        const db = yield* currentDb;
        const [user] = yield* db
          .select()
          .from(schema.userTable)
          .where(eq(schema.userTable.id, second.userId));
        expect(user?.email).toMatch(/^sso-[0-9a-f]{16}@feeblo\.com$/);
      })
    );
  });
});

describe("linkAnonymousAccount", () => {
  const makeLinkFixture = () =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const anonymousUserId = yield* WorkspaceId.generate; // ids are opaque strings
      const newUserId = yield* WorkspaceId.generate;
      const contactId = yield* WorkspaceId.generate;
      const now = new Date();

      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Test organization",
        slug: organizationId,
        createdAt: now,
      });
      yield* db.insert(schema.userTable).values({
        id: anonymousUserId,
        email: `widget+${anonymousUserId}@example.com`,
        name: "Widget User",
        restrictedToOrganizationId: organizationId,
      });
      yield* db.insert(schema.userTable).values({
        id: newUserId,
        email: `real+${newUserId}@example.com`,
        name: "Real User",
      });
      yield* db.insert(schema.contactTable).values({
        id: contactId,
        organizationId,
        userId: anonymousUserId,
        name: "Widget Contact",
        createdAt: now,
      });

      return { anonymousUserId, contactId, newUserId };
    });

  const contactOwner = (contactId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const rows = yield* db
        .select({ userId: schema.contactTable.userId })
        .from(schema.contactTable)
        .where(eq(schema.contactTable.id, contactId));
      return rows[0]?.userId ?? null;
    });

  it.effect("re-assigns contacts and posts to the real user", () =>
    Effect.gen(function* () {
      const { anonymousUserId, contactId, newUserId } =
        yield* makeLinkFixture();

      yield* linkAnonymousAccount({ anonymousUserId, newUserId });

      expect(yield* contactOwner(contactId)).toBe(newUserId);
    }).pipe(Effect.provide(TestLayer))
  );

  it.effect("is a no-op when both ids are the same", () =>
    Effect.gen(function* () {
      const { anonymousUserId, contactId } = yield* makeLinkFixture();

      yield* linkAnonymousAccount({
        anonymousUserId,
        newUserId: anonymousUserId,
      });

      expect(yield* contactOwner(contactId)).toBe(anonymousUserId);
    }).pipe(Effect.provide(TestLayer))
  );

  it.effect("refuses to link a non-restricted user's data", () =>
    Effect.gen(function* () {
      const { anonymousUserId, contactId, newUserId } =
        yield* makeLinkFixture();
      const db = yield* currentDb;
      const attackerId = yield* WorkspaceId.generate;
      yield* db.insert(schema.userTable).values({
        id: attackerId,
        email: `attacker+${attackerId}@example.com`,
        name: "Attacker",
      });

      const error = yield* Effect.flip(
        linkAnonymousAccount({ anonymousUserId: attackerId, newUserId })
      );
      expect(error.code).toBe("ANONYMOUS_USER_NOT_RESTRICTED");
      expect(yield* contactOwner(contactId)).toBe(anonymousUserId);
    }).pipe(Effect.provide(TestLayer))
  );

  it.effect("refuses to link data to an anonymous target", () =>
    Effect.gen(function* () {
      const { anonymousUserId, contactId, newUserId } =
        yield* makeLinkFixture();
      const db = yield* currentDb;
      yield* db
        .update(schema.userTable)
        .set({ restrictedToOrganizationId: "another_org" })
        .where(eq(schema.userTable.id, newUserId));

      const error = yield* Effect.flip(
        linkAnonymousAccount({ anonymousUserId, newUserId })
      );
      expect(error.code).toBe("NEW_USER_IS_ANONYMOUS");
      expect(yield* contactOwner(contactId)).toBe(anonymousUserId);
    }).pipe(Effect.provide(TestLayer))
  );

  it.effect("refuses to link a missing anonymous user", () =>
    Effect.gen(function* () {
      const { anonymousUserId, contactId, newUserId } =
        yield* makeLinkFixture();

      const error = yield* Effect.flip(
        linkAnonymousAccount({ anonymousUserId: "does-not-exist", newUserId })
      );
      expect(error.code).toBe("ANONYMOUS_USER_NOT_FOUND");
      expect(yield* contactOwner(contactId)).toBe(anonymousUserId);
    }).pipe(Effect.provide(TestLayer))
  );

  it.effect("refuses to link to a missing real user", () =>
    Effect.gen(function* () {
      const { anonymousUserId, contactId } = yield* makeLinkFixture();

      const error = yield* Effect.flip(
        linkAnonymousAccount({
          anonymousUserId,
          newUserId: "does-not-exist",
        })
      );
      expect(error.code).toBe("NEW_USER_NOT_FOUND");
      expect(yield* contactOwner(contactId)).toBe(anonymousUserId);
    }).pipe(Effect.provide(TestLayer))
  );
});
