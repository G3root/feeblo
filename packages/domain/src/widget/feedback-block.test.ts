import { NodeCrypto } from "@effect/platform-node";
import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { ContactId, UserId, WorkspaceId } from "@feeblo/id";
import { and, count, eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as jose from "jose";

import { AttributeDefinitionRepository } from "../attribute-definition/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import { JwtSecretRepository } from "../jwt-secret/repository";
import { OrganizationRepository } from "../organization/repository";
import { ParticipationPolicy } from "../user-block/policies";
import { WorkspaceRepository } from "../workspace/repository";
import { resolveFeedbackContact } from "./api-live";
import { SsoRepositoriesLive } from "./sso";

/** The `Date` for a known instant, built through `DateTime`. */
const dateAt = (instant: number): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(instant));

const signToken = (payload: jose.JWTPayload, secret: string) =>
  Effect.promise(() =>
    new jose.SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .sign(new Uint8Array(Buffer.from(secret, "hex")))
  );

const TestLayer = Layer.mergeAll(
  SsoRepositoriesLive,
  EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer)),
  ParticipationPolicy.layer,
  NodeCrypto.layer
).pipe(Layer.provideMerge(Database.PgliteDatabaseLive));

describe("resolveFeedbackContact", () => {
  type Fixture = {
    organizationId: string;
    secret: string;
  };

  const makeFixture = Effect.fnUntraced(function* () {
    const db = yield* currentDb;
    const organizationId = yield* WorkspaceId.generate;
    const now = yield* DateTime.nowAsDate;
    const secret = "a".repeat(64);

    yield* db.insert(schema.organizationTable).values({
      id: organizationId,
      name: "Widget feedback workspace",
      slug: organizationId,
      createdAt: now,
    });
    yield* db.insert(schema.jwtSecretTable).values({
      createdAt: now,
      id: `jwt_secret_${organizationId}`,
      organizationId,
      revokedAt: null,
      secret,
    });
    // A plan with room for the contact the SSO upsert files. Without it the
    // request would fail on the CRM-entry allowance before the block is read.
    const productId = `prod_feedback_${organizationId}`;
    yield* db.insert(schema.productTable).values({
      externalOrganizationId: "polar_org",
      id: productId,
      isArchived: false,
      isRecurring: true,
      metadata: { plan: "starter", variant: "monthly" },
      name: "Starter monthly",
      visibility: "PUBLIC",
    });
    yield* db.insert(schema.subscriptionTable).values({
      amount: 4900,
      cancelAtPeriodEnd: false,
      currency: "usd",
      currentPeriodEnd: dateAt(now.getTime() + 86_400_000),
      currentPeriodStart: now,
      customerId: `cus_feedback_${organizationId}`,
      externalId: `sub_ext_feedback_${organizationId}`,
      id: `sub_feedback_${organizationId}`,
      organizationId,
      productId,
      recurringInterval: "month",
      recurringIntervalCount: 1,
      status: "trialing",
    });
    return { organizationId, secret } satisfies Fixture;
  });

  const feedbackToken = (fixture: Fixture, email: string) =>
    Effect.gen(function* () {
      const now = yield* DateTime.nowAsDate;
      const nowSeconds = Math.floor(now.getTime() / 1000);
      return yield* signToken(
        {
          aud: fixture.organizationId,
          email,
          exp: nowSeconds + 3600,
          iat: nowSeconds,
          name: "Ada Lovelace",
          sub: "external_ada",
        },
        fixture.secret
      );
    });

  const services = Effect.gen(function* () {
    return {
      attributeDefinitionRepository: yield* AttributeDefinitionRepository,
      entitlementPolicy: yield* EntitlementPolicy,
      jwtSecretRepository: yield* JwtSecretRepository,
      organizationRepository: yield* OrganizationRepository,
      participation: yield* ParticipationPolicy,
    };
  });

  const contactCount = (organizationId: string, email: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const [row] = yield* db
        .select({ total: count() })
        .from(schema.contactTable)
        .where(
          and(
            eq(schema.contactTable.organizationId, organizationId),
            eq(schema.contactTable.email, email)
          )
        );
      return row?.total ?? 0;
    });

  const postCount = (organizationId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const [row] = yield* db
        .select({ total: count() })
        .from(schema.postTable)
        .where(eq(schema.postTable.organizationId, organizationId));
      return row?.total ?? 0;
    });

  layer(TestLayer)("block checks", (it) => {
    it.effect("denies an email-only block and rolls back the new contact", () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const db = yield* currentDb;
        const now = yield* DateTime.nowAsDate;
        const email = "blocked-by-email@example.com";

        yield* db.insert(schema.userBlockTable).values({
          createdAt: now,
          email,
          id: `block_email_${fixture.organizationId}`,
          organizationId: fixture.organizationId,
          reason: "Abuse report",
          updatedAt: now,
          userId: null,
        });

        const token = yield* feedbackToken(fixture, email);
        const error = yield* Effect.flip(
          resolveFeedbackContact({
            ...(yield* services),
            organizationId: fixture.organizationId,
            token,
          })
        );

        expect(error._tag).toBe("PolicyDenied");
        // The contact upsert and the block check share a transaction, so a
        // denial must not leave the customer the upsert just created.
        expect(yield* contactCount(fixture.organizationId, email)).toBe(0);
        expect(yield* postCount(fixture.organizationId)).toBe(0);
      })
    );

    it.effect("denies a user-id block and keeps the existing contact", () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const db = yield* currentDb;
        const now = yield* DateTime.nowAsDate;
        const email = "blocked-by-user@example.com";
        const userId = yield* UserId.generate;
        const contactId = yield* ContactId.generate;

        yield* db.insert(schema.userTable).values({
          email,
          id: userId,
          name: "Ada Lovelace",
        });
        yield* db.insert(schema.contactTable).values({
          createdAt: now,
          email,
          id: contactId,
          name: "Ada Lovelace",
          organizationId: fixture.organizationId,
          updatedAt: now,
          userId,
        });
        // A user-id-only block: the contact already links the account, so the
        // widget's block check resolves the account through the contact.
        yield* db.insert(schema.userBlockTable).values({
          createdAt: now,
          email: null,
          id: `block_user_${fixture.organizationId}`,
          organizationId: fixture.organizationId,
          reason: null,
          updatedAt: now,
          userId,
        });

        const token = yield* feedbackToken(fixture, email);
        const error = yield* Effect.flip(
          resolveFeedbackContact({
            ...(yield* services),
            organizationId: fixture.organizationId,
            token,
          })
        );

        expect(error._tag).toBe("PolicyDenied");
        expect(yield* contactCount(fixture.organizationId, email)).toBe(1);
        expect(yield* postCount(fixture.organizationId)).toBe(0);

        const [contact] = yield* db
          .select({ userId: schema.contactTable.userId })
          .from(schema.contactTable)
          .where(eq(schema.contactTable.id, contactId));
        // The feedback upsert does not unlink an existing account while the
        // block is being checked, and the denial rolls back its other changes.
        expect(contact?.userId).toBe(userId);
      })
    );
  });
});
