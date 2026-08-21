import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { EmailOutboxRepository } from "../email-outbox/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import { RateLimitService } from "../rate-limit/service";
import type { Session } from "../session-middleware";
import { CurrentSession } from "../session-middleware";
import { WorkspaceRepository } from "../workspace/repository";
import {
  EmailSubscriptionConsentHandlersEffect,
  EmailSubscriptionRpcHandlersEffect,
} from "./handlers";
import { EmailSubscriptionRepository } from "./repository";
import { EmailSubscriptionTokenService } from "./tokens";

describe("EmailSubscriptionConsentHandlers", () => {
  const Repositories = Layer.mergeAll(
    EmailOutboxRepository.layer,
    EmailSubscriptionRepository.layerWithoutDependencies.pipe(
      Layer.provide(
        EmailSubscriptionTokenService.layerTest(
          "email-subscription-handler-test-signing-secret"
        )
      )
    ),
    WorkspaceRepository.layer
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));
  const TestLayer = Layer.mergeAll(
    Repositories,
    EntitlementPolicy.layer.pipe(Layer.provide(Repositories)),
    RateLimitService.layerMemory,
    Database.PgliteDatabaseLive
  );

  const createWorkspace = ({ paid }: { readonly paid: boolean }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const now = new Date("2026-08-09T00:00:00.000Z");
      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Subscription workspace",
        slug: organizationId,
        createdAt: now,
      });
      if (!paid) {
        return organizationId;
      }
      const productId = `product_${organizationId}`;
      yield* db.insert(schema.productTable).values({
        id: productId,
        name: "Starter",
        isArchived: false,
        isRecurring: true,
        externalOrganizationId: "feeblo",
        visibility: "public",
        metadata: { plan: "starter", variant: "monthly" },
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.subscriptionTable).values({
        id: `subscription_${organizationId}`,
        externalId: `external_${organizationId}`,
        organizationId,
        amount: 1000,
        cancelAtPeriodEnd: false,
        currency: "usd",
        recurringInterval: "month",
        recurringIntervalCount: 1,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 86_400_000),
        customerId: `customer_${organizationId}`,
        productId,
        createdAt: now,
        updatedAt: now,
      });
      return organizationId;
    });

  /** A signed-in visitor identity; `email_contact.user_id` needs a user row. */
  const createUser = (organizationId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const userId = `user_${organizationId}`;
      const email = `owner_${organizationId}@example.com`;
      yield* db.insert(schema.userTable).values({
        id: userId,
        email,
        name: "Test User",
      });
      return { email, userId };
    });

  const makeSession = (args: {
    readonly email: string;
    readonly organizationId: string;
    readonly userId: string;
  }): Session => ({
    user: {
      id: args.userId,
      email: args.email,
      name: "Test User",
      restrictedToOrganizationId: null,
    },
    session: { userId: args.userId, token: "test-token" },
    organizations: [{ id: args.organizationId }],
    memberships: [],
  });

  layer(TestLayer)("handlers", (it) => {
    it.effect(
      "rejects manual changelog subscriptions for free workspaces",
      () =>
        Effect.gen(function* () {
          const handlers = yield* EmailSubscriptionConsentHandlersEffect;
          const organizationId = yield* createWorkspace({ paid: false });

          const error = yield* Effect.flip(
            handlers.requestChangelogSubscription({
              email: "subscriber@example.com",
              organizationId,
            })
          );
          expect(error._tag).toBe("PolicyDenied");
        })
    );

    it.effect(
      "creates a pending double-opt-in subscription with redacted mail-boundary tokens",
      () =>
        Effect.gen(function* () {
          const handlers = yield* EmailSubscriptionConsentHandlersEffect;
          const repository = yield* EmailSubscriptionRepository;
          const organizationId = yield* createWorkspace({ paid: true });

          const accepted = yield* handlers.requestChangelogSubscription({
            email: " Subscriber@Example.com ",
            organizationId,
          });
          expect(accepted.verificationRequired).toBe(true);
          expect(Option.isSome(accepted.verificationToken)).toBe(true);
          const subscription = yield* repository.findSubscription({
            email: "subscriber@example.com",
            organizationId,
            topic: { topicId: null, topicType: "changelog" },
          });
          expect(Option.getOrUndefined(subscription)).toMatchObject({
            state: "pending_verification",
          });
        })
    );

    it.effect(
      "keeps verification tokens out of the public RPC acknowledgement",
      () =>
        Effect.gen(function* () {
          const handlers = yield* EmailSubscriptionRpcHandlersEffect;
          const organizationId = yield* createWorkspace({ paid: true });

          expect(
            yield* handlers.EmailSubscriptionChangelogSubscribePublic({
              email: "subscriber@example.com",
              organizationId,
            })
          ).toEqual({ verificationRequired: true });
        })
    );

    it.effect(
      "rate-limits verification requests by workspace and normalized address",
      () =>
        Effect.gen(function* () {
          const handlers = yield* EmailSubscriptionConsentHandlersEffect;
          const organizationId = yield* createWorkspace({ paid: true });
          for (const email of [
            "subscriber@example.com",
            " SUBSCRIBER@example.com ",
            "subscriber@example.com",
          ]) {
            yield* handlers.requestChangelogSubscription({
              email,
              organizationId,
            });
          }
          const error = yield* Effect.flip(
            handlers.requestChangelogSubscription({
              email: "subscriber@example.com",
              organizationId,
            })
          );
          expect(error._tag).toBe("RateLimitExceededError");
        })
    );

    it.effect(
      "activates verification and unsubscribes idempotently by opaque tokens",
      () =>
        Effect.gen(function* () {
          const handlers = yield* EmailSubscriptionConsentHandlersEffect;
          const organizationId = yield* createWorkspace({ paid: true });
          const accepted = yield* handlers.requestChangelogSubscription({
            email: "subscriber@example.com",
            organizationId,
          });
          if (
            Option.isNone(accepted.verificationToken) ||
            Option.isNone(accepted.unsubscribeToken)
          ) {
            return expect.fail(
              "A new consent request must issue both link tokens"
            );
          }
          const verificationToken = Redacted.value(
            accepted.verificationToken.value
          );
          const verified = yield* handlers.verifySubscription({
            verificationToken,
          });
          expect(verified.verified).toBe(true);
          expect(
            yield* handlers.verifySubscription({ verificationToken })
          ).toEqual({ verified: true });

          const unsubscribed = yield* handlers.unsubscribe({
            unsubscribeToken: Redacted.value(accepted.unsubscribeToken.value),
          });
          expect(unsubscribed).toEqual({ unsubscribed: true });
          expect(
            yield* handlers.unsubscribe({
              unsubscribeToken: Redacted.value(accepted.unsubscribeToken.value),
            })
          ).toEqual({ unsubscribed: true });
        })
    );

    it.effect("keeps changelog consent isolated from a post topic", () =>
      Effect.gen(function* () {
        const handlers = yield* EmailSubscriptionConsentHandlersEffect;
        const repository = yield* EmailSubscriptionRepository;
        const organizationId = yield* createWorkspace({ paid: true });
        const accepted = yield* handlers.requestChangelogSubscription({
          email: "subscriber@example.com",
          organizationId,
        });
        if (
          Option.isNone(accepted.verificationToken) ||
          Option.isNone(accepted.unsubscribeToken)
        ) {
          return expect.fail(
            "A new consent request must issue both link tokens"
          );
        }
        yield* handlers.verifySubscription({
          verificationToken: Redacted.value(accepted.verificationToken.value),
        });
        const post = yield* repository.requestSubscription({
          email: "subscriber@example.com",
          now: new Date(),
          organizationId,
          source: "explicit",
          topic: { topicId: "pst_1", topicType: "post" },
          verificationExpiresAt: new Date(Date.now() + 86_400_000),
        });
        yield* handlers.unsubscribe({
          unsubscribeToken: Redacted.value(accepted.unsubscribeToken.value),
        });
        const changelog = yield* repository.findSubscription({
          email: "subscriber@example.com",
          organizationId,
          topic: { topicId: null, topicType: "changelog" },
        });
        expect(Option.getOrUndefined(changelog)).toMatchObject({
          state: "unsubscribed",
        });
        expect(post.subscription.state).toBe("pending_verification");
      })
    );

    it.effect(
      "toggles the signed-in user's changelog subscription without double opt-in",
      () =>
        Effect.gen(function* () {
          const handlers = yield* EmailSubscriptionRpcHandlersEffect;
          const repository = yield* EmailSubscriptionRepository;
          const organizationId = yield* createWorkspace({ paid: true });
          const user = yield* createUser(organizationId);
          const session = makeSession({ ...user, organizationId });

          const statusOf = () =>
            handlers
              .EmailSubscriptionChangelogStatusGet({ organizationId })
              .pipe(Effect.provideService(CurrentSession, session));

          expect(yield* statusOf()).toEqual({ subscribed: false });

          expect(
            yield* handlers
              .EmailSubscriptionChangelogSubscribeSet({
                organizationId,
                subscribed: true,
              })
              .pipe(Effect.provideService(CurrentSession, session))
          ).toEqual({ subscribed: true });
          expect(
            yield* repository.findAuthenticatedSubscription({
              organizationId,
              topic: { topicId: null, topicType: "changelog" },
              userId: user.userId,
            })
          ).toMatchObject({ state: "active" });
          expect(yield* statusOf()).toEqual({ subscribed: true });

          expect(
            yield* handlers
              .EmailSubscriptionChangelogSubscribeSet({
                organizationId,
                subscribed: false,
              })
              .pipe(Effect.provideService(CurrentSession, session))
          ).toEqual({ subscribed: false });
          expect(
            yield* repository.findAuthenticatedSubscription({
              organizationId,
              topic: { topicId: null, topicType: "changelog" },
              userId: user.userId,
            })
          ).toMatchObject({ state: "unsubscribed" });
          expect(yield* statusOf()).toEqual({ subscribed: false });
        })
    );

    it.effect(
      "allows authenticated changelog subscriptions on free workspaces",
      () =>
        Effect.gen(function* () {
          const handlers = yield* EmailSubscriptionRpcHandlersEffect;
          const repository = yield* EmailSubscriptionRepository;
          const organizationId = yield* createWorkspace({ paid: false });
          const user = yield* createUser(organizationId);

          expect(
            yield* handlers
              .EmailSubscriptionChangelogSubscribeSet({
                organizationId,
                subscribed: true,
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession({ ...user, organizationId })
                )
              )
          ).toEqual({ subscribed: true });
          // Subscribing activates immediately on every plan; only email
          // delivery is withheld on free.
          expect(
            yield* repository.findAuthenticatedSubscription({
              organizationId,
              topic: { topicId: null, topicType: "changelog" },
              userId: user.userId,
            })
          ).toMatchObject({ state: "active" });
        })
    );
  });
});
