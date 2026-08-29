import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { and, eq } from "drizzle-orm";

import { EmailOutboxRepository } from "../email-outbox/repository";
import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { EmailSubscriptionTokenService } from "../email-subscription/tokens";
import { EntitlementPolicy } from "../entitlement/policies";
import { RateLimitService } from "../rate-limit/service";
import { SitePolicy } from "../site/policies";
import { CurrentSession, type Session } from "../session-middleware";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { ChangelogSubscriptionRpcHandlersEffect } from "./handlers";
import { ChangelogSubscriptionRepository } from "./repository";

describe("ChangelogSubscriptionRpcHandlers", () => {
  const Repositories = Layer.mergeAll(
    EmailOutboxRepository.layer,
    ChangelogSubscriptionRepository.layer,
    EmailSubscriptionRepository.layerWithoutDependencies.pipe(
      Layer.provide(
        EmailSubscriptionTokenService.layerTest(
          "changelog-subscription-handler-test-signing-secret"
        )
      )
    ),
    WorkspaceRepository.layer
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));
  const Entitlements = EntitlementPolicy.layer.pipe(
    Layer.provide(Repositories)
  );
  const SiteRepositories = Layer.mergeAll(
    SiteRepository.layer,
    WorkspaceRepository.layer
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));
  const TestLayer = Layer.mergeAll(
    Repositories,
    SiteRepositories,
    SitePolicy.layer.pipe(
      Layer.provide(Entitlements),
      Layer.provide(SiteRepositories)
    ),
    Entitlements,
    RateLimitService.layerMemory,
    Database.PgliteDatabaseLive
  );

  const createWorkspace = ({
    changelogVisibility = "PUBLIC",
    paid,
  }: {
    readonly changelogVisibility?: "PUBLIC" | "HIDDEN";
    readonly paid: boolean;
  }) =>
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
      yield* db.insert(schema.siteTable).values({
        id: `site_${organizationId}`,
        name: "Subscription site",
        subdomain: `test-${organizationId}`,
        customDomain: null,
        changelogVisibility,
        roadmapVisibility: "PUBLIC",
        hidePoweredBy: false,
        organizationId,
        createdAt: now,
        updatedAt: now,
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

  /** A signed-in visitor identity; the subscription tables key off its user. */
  const createUser = (
    organizationId: string,
    options: { withMembership?: boolean; label?: string } = {}
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const userId = `user_${options.label ?? ""}${organizationId}`;
      const email = `owner_${options.label ?? ""}${organizationId}@example.com`;
      yield* db.insert(schema.userTable).values({
        id: userId,
        email,
        name: "Test User",
      });
      let membershipId: string | undefined;
      if (options.withMembership) {
        membershipId = `member_${options.label ?? ""}${organizationId}`;
        yield* db.insert(schema.memberTable).values({
          id: membershipId,
          organizationId,
          userId,
          role: "manager",
          createdAt: new Date(),
        });
      }
      return {
        email,
        userId,
        ...(membershipId && { membershipId }),
      };
    });

  const makeSession = (args: {
    readonly email: string;
    readonly organizationId: string;
    readonly userId: string;
    readonly membershipId?: string | undefined;
  }): Session => ({
    user: {
      id: args.userId,
      email: args.email,
      name: "Test User",
      restrictedToOrganizationId: null,
    },
    session: { userId: args.userId, token: "test-token" },
    organizations: [{ id: args.organizationId }],
    memberships: args.membershipId
      ? [
          {
            membershipId: args.membershipId,
            organizationId: args.organizationId,
            role: "manager",
          },
        ]
      : [],
  });

  /** Finds the user-keyed changelog subscription row, if any. */
  const findChangelogRow = (args: {
    organizationId: string;
    userId: string;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      return yield* db
        .select()
        .from(schema.changelogSubscriptionTable)
        .where(
          and(
            eq(
              schema.changelogSubscriptionTable.organizationId,
              args.organizationId
            ),
            eq(schema.changelogSubscriptionTable.userId, args.userId)
          )
        );
    });

  layer(TestLayer)("handlers", (it) => {
    it.effect(
      "toggles the signed-in user's changelog subscription without double opt-in",
      () =>
        Effect.gen(function* () {
          const handlers = yield* ChangelogSubscriptionRpcHandlersEffect;
          const emailRepository = yield* EmailSubscriptionRepository;
          const organizationId = yield* createWorkspace({ paid: true });
          const user = yield* createUser(organizationId);
          const session = makeSession({ ...user, organizationId });

          // Subscribing writes both the user-keyed row that drives in-app
          // notifications and the email_subscription row that drives delivery.
          expect(
            yield* handlers
              .ChangelogSubscriptionCreatePublic({ organizationId })
              .pipe(Effect.provideService(CurrentSession, session))
          ).toEqual({ subscribed: true });
          expect(
            yield* findChangelogRow({ organizationId, userId: user.userId })
          ).toHaveLength(1);
          expect(
            yield* emailRepository.findAuthenticatedSubscription({
              organizationId,
              topic: { topicId: null, topicType: "changelog" },
              userId: user.userId,
            })
          ).toMatchObject({ state: "active" });

          expect(
            yield* handlers
              .ChangelogSubscriptionDeletePublic({ organizationId })
              .pipe(Effect.provideService(CurrentSession, session))
          ).toEqual({ subscribed: false });
          expect(
            yield* findChangelogRow({ organizationId, userId: user.userId })
          ).toHaveLength(0);
          expect(
            yield* emailRepository.findAuthenticatedSubscription({
              organizationId,
              topic: { topicId: null, topicType: "changelog" },
              userId: user.userId,
            })
          ).toMatchObject({ state: "unsubscribed" });
        })
    );

    it.effect(
      "records the workspace membership on the subscription for members",
      () =>
        Effect.gen(function* () {
          const handlers = yield* ChangelogSubscriptionRpcHandlersEffect;
          const organizationId = yield* createWorkspace({ paid: true });
          const member = yield* createUser(organizationId, {
            withMembership: true,
          });
          const session = makeSession({
            ...member,
            organizationId,
            membershipId: member.membershipId,
          });

          yield* handlers
            .ChangelogSubscriptionCreate({ organizationId })
            .pipe(Effect.provideService(CurrentSession, session));

          const [row] = yield* findChangelogRow({
            organizationId,
            userId: member.userId,
          });
          expect(row?.memberId).toBe(member.membershipId);
        })
    );

    it.effect(
      "allows authenticated changelog subscriptions on free workspaces",
      () =>
        Effect.gen(function* () {
          const handlers = yield* ChangelogSubscriptionRpcHandlersEffect;
          const organizationId = yield* createWorkspace({ paid: false });
          const user = yield* createUser(organizationId);

          expect(
            yield* handlers
              .ChangelogSubscriptionCreatePublic({ organizationId })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession({ ...user, organizationId })
                )
              )
          ).toEqual({ subscribed: true });
          expect(
            yield* findChangelogRow({ organizationId, userId: user.userId })
          ).toHaveLength(1);
        })
    );

    it.effect("lists a subscriber roster to members", () =>
      Effect.gen(function* () {
        const handlers = yield* ChangelogSubscriptionRpcHandlersEffect;
        const organizationId = yield* createWorkspace({ paid: true });
        const member = yield* createUser(organizationId, {
          withMembership: true,
        });
        const visitor = yield* createUser(organizationId, {
          label: "visitor",
        });
        const memberSession = makeSession({
          ...member,
          organizationId,
          membershipId: member.membershipId,
        });

        yield* handlers
          .ChangelogSubscriptionCreate({ organizationId })
          .pipe(Effect.provideService(CurrentSession, memberSession));
        yield* handlers
          .ChangelogSubscriptionCreatePublic({ organizationId })
          .pipe(
            Effect.provideService(
              CurrentSession,
              makeSession({ ...visitor, organizationId })
            )
          );

        const roster = yield* handlers
          .ChangelogSubscriptionList({ organizationId })
          .pipe(Effect.provideService(CurrentSession, memberSession));
        expect(roster.map((row) => row.userId).sort()).toEqual(
          [member.userId, visitor.userId].sort()
        );

        // Public lists only ever expose the current visitor's own row.
        const publicRows = yield* handlers
          .ChangelogSubscriptionListPublic({ organizationId })
          .pipe(
            Effect.provideService(
              CurrentSession,
              makeSession({ ...visitor, organizationId })
            )
          );
        expect(publicRows.map((row) => row.userId)).toEqual([visitor.userId]);
      })
    );

    it.effect("denies subscriptions to a hidden changelog", () =>
      Effect.gen(function* () {
        const handlers = yield* ChangelogSubscriptionRpcHandlersEffect;
        const organizationId = yield* createWorkspace({
          changelogVisibility: "HIDDEN",
          paid: true,
        });
        const user = yield* createUser(organizationId);
        const scoped = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          effect.pipe(
            Effect.provideService(
              CurrentSession,
              makeSession({ ...user, organizationId })
            )
          );

        const subscribeError = yield* Effect.flip(
          handlers
            .ChangelogSubscriptionCreatePublic({ organizationId })
            .pipe(scoped)
        );
        expect(subscribeError._tag).toBe("PolicyDenied");

        const listError = yield* Effect.flip(
          handlers.ChangelogSubscriptionListPublic({ organizationId }).pipe(
            scoped
          )
        );
        expect(listError._tag).toBe("PolicyDenied");
      })
    );

    it.effect(
      "confines organization-restricted sessions to their own workspace",
      () =>
        Effect.gen(function* () {
          const handlers = yield* ChangelogSubscriptionRpcHandlersEffect;
          const organizationId = yield* createWorkspace({ paid: true });
          const user = yield* createUser(organizationId);
          const restrictedSession: Session = {
            user: {
              id: user.userId,
              email: user.email,
              name: "Test User",
              restrictedToOrganizationId: "org_some_other_workspace",
            },
            session: { userId: user.userId, token: "test-token" },
            organizations: [{ id: organizationId }],
            memberships: [],
          };

          const subscribeError = yield* Effect.flip(
            handlers
              .ChangelogSubscriptionCreatePublic({ organizationId })
              .pipe(Effect.provideService(CurrentSession, restrictedSession))
          );
          expect(subscribeError._tag).toBe("PolicyDenied");

          const listError = yield* Effect.flip(
            handlers
              .ChangelogSubscriptionListPublic({ organizationId })
              .pipe(Effect.provideService(CurrentSession, restrictedSession))
          );
          expect(listError._tag).toBe("PolicyDenied");
        })
    );
  });
});