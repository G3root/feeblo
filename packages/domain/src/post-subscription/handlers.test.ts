import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  BoardId,
  type LegidOf,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { EmailSubscriptionTokenService } from "../email-subscription/tokens";
import { EntitlementPolicy } from "../entitlement/policies";
import { PostPolicy } from "../post/policies";
import { PostRepository } from "../post/repository";
import { CurrentSession, type Session } from "../session-middleware";
import { WorkspaceRepository } from "../workspace/repository";
import { PostSubscriptionRpcHandlersEffect } from "./handlers";
import { PostSubscriptionRepository } from "./repository";

describe("PostSubscriptionRpcHandlers", () => {
  type Fixture = {
    membershipId: string;
    organizationId: LegidOf<"WorkspaceId">;
    postId: LegidOf<"PostId">;
    postSlug: string;
    statusId: LegidOf<"PostStatusId">;
    userId: string;
  };
  const session = (
    f: Fixture,
    member = true,
    restrictedToOrganizationId: string | null = null
  ): Session => ({
    user: {
      id: f.userId,
      email: "user@example.com",
      name: "User",
      restrictedToOrganizationId,
    },
    session: { userId: f.userId, token: "token" },
    organizations: [{ id: f.organizationId }],
    memberships: member
      ? [
          {
            membershipId: f.membershipId,
            organizationId: f.organizationId,
            role: "owner",
          },
        ]
      : [],
  });
  const fixture = (visibility: "PUBLIC" | "PRIVATE" = "PUBLIC") =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const boardId = yield* BoardId.generate;
      const postId = yield* PostId.generate;
      const postSlug = `post-${postId}`;
      const statusId = yield* PostStatusId.generate;
      const userId = `user_${organizationId}`;
      const membershipId = `member_${organizationId}`;
      const now = yield* DateTime.nowAsDate;
      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Organization",
        slug: organizationId,
        createdAt: now,
      });
      yield* db.insert(schema.userTable).values({
        id: userId,
        email: `${organizationId}@example.com`,
        name: "User",
      });
      yield* db.insert(schema.memberTable).values({
        id: membershipId,
        organizationId,
        userId,
        role: "owner",
        createdAt: now,
      });
      yield* db.insert(schema.boardTable).values({
        id: boardId,
        name: "Board",
        slug: boardId,
        visibility,
        organizationId,
        creatorId: userId,
        creatorMemberId: membershipId,
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.postStatusTable).values({
        id: statusId,
        type: "PENDING",
        orderIndex: 0,
        organizationId,
      });
      yield* db.insert(schema.postTable).values({
        id: postId,
        title: "Post",
        content: "Content",
        slug: postSlug,
        excerpt: "Content",
        boardId,
        organizationId,
        statusId,
        creatorId: userId,
        creatorMemberId: membershipId,
        createdAt: now,
        updatedAt: now,
      });
      return {
        membershipId,
        organizationId,
        postId,
        postSlug,
        statusId,
        userId,
      } satisfies Fixture;
    });
  /**
   * Puts the workspace on Starter. A private board is a paid capability and
   * is read-only on free, so a test about private-board read hiding has to
   * build the private board the way a paying workspace would.
   */
  const grantStarterPlan = (organizationId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const now = yield* DateTime.nowAsDate;
      const productId = `product_starter_${organizationId}`;

      yield* db.insert(schema.productTable).values({
        id: productId,
        name: "Starter",
        isRecurring: true,
        isArchived: false,
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
        amount: 2900,
        cancelAtPeriodEnd: false,
        currency: "usd",
        recurringInterval: "month",
        recurringIntervalCount: 1,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: DateTime.toDateUtc(
          DateTime.addDuration(DateTime.fromDateUnsafe(now), Duration.days(30))
        ),
        customerId: `customer_${organizationId}`,
        productId,
        createdAt: now,
        updatedAt: now,
      });
    });

  const Repositories = Layer.mergeAll(
    PostRepository.layer,
    PostSubscriptionRepository.layer,
    EmailSubscriptionRepository.layerWithoutDependencies.pipe(
      Layer.provide(
        EmailSubscriptionTokenService.layerTest(
          "post-subscription-handler-test-signing-secret"
        )
      )
    )
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));
  const EntitlementTest = EntitlementPolicy.layer.pipe(
    Layer.provide(WorkspaceRepository.layer),
    Layer.provide(Database.PgliteDatabaseLive)
  );
  const TestLayer = PostPolicy.layer.pipe(
    Layer.provideMerge(EntitlementTest),
    Layer.provideMerge(Repositories)
  );

  layer(Layer.merge(TestLayer, Database.PgliteDatabaseLive))(
    "handlers",
    (it) => {
      it.effect(
        "does not expose subscribers to users without a membership",
        () =>
          Effect.gen(function* () {
            const handlers = yield* PostSubscriptionRpcHandlersEffect;
            const f = yield* fixture();
            const error = yield* Effect.flip(
              handlers
                .ListPostSubscriptions({
                  organizationId: f.organizationId,
                  slug: f.postSlug,
                })
                .pipe(Effect.provideService(CurrentSession, session(f, false)))
            );
            expect(error._tag).toBe("PolicyDenied");
          })
      );
      it.effect("subscribes, lists, and unsubscribes members", () =>
        Effect.gen(function* () {
          const handlers = yield* PostSubscriptionRpcHandlersEffect;
          const f = yield* fixture();
          const listInput = {
            organizationId: f.organizationId,
            slug: f.postSlug,
          };
          const mutationInput = {
            organizationId: f.organizationId,
            postId: f.postId,
          };
          expect(
            yield* handlers
              .CreatePostSubscription(mutationInput)
              .pipe(Effect.provideService(CurrentSession, session(f)))
          ).toEqual({ subscribed: true });
          expect(
            yield* handlers
              .ListPostSubscriptions(listInput)
              .pipe(Effect.provideService(CurrentSession, session(f)))
          ).toMatchObject([
            { postId: f.postId, userId: f.userId, memberId: f.membershipId },
          ]);
          expect(
            yield* handlers
              .DeletePostSubscription(mutationInput)
              .pipe(Effect.provideService(CurrentSession, session(f)))
          ).toEqual({ subscribed: false });
          expect(
            yield* handlers
              .ListPostSubscriptions(listInput)
              .pipe(Effect.provideService(CurrentSession, session(f)))
          ).toHaveLength(0);
          const emailSubscription =
            yield* (yield* EmailSubscriptionRepository).findSubscription({
              email: "user@example.com",
              organizationId: f.organizationId,
              topic: { topicId: f.postId, topicType: "post" },
            });
          expect(emailSubscription.pipe(Option.getOrUndefined)).toMatchObject({
            state: "unsubscribed",
          });
        })
      );
      it.effect(
        "rolls back the legacy subscription when email consent fails",
        () =>
          Effect.gen(function* () {
            const handlers = yield* PostSubscriptionRpcHandlersEffect;
            const f = yield* fixture();
            const listInput = {
              organizationId: f.organizationId,
              slug: f.postSlug,
            };
            const mutationInput = {
              organizationId: f.organizationId,
              postId: f.postId,
            };
            const validSession = session(f);
            const invalidEmailSession: Session = {
              ...validSession,
              user: { ...validSession.user, email: "invalid-email" },
            };

            const error = yield* Effect.flip(
              handlers
                .CreatePostSubscription(mutationInput)
                .pipe(
                  Effect.provideService(CurrentSession, invalidEmailSession)
                )
            );

            expect(error._tag).toBe("InternalServerError");
            expect(
              yield* handlers
                .ListPostSubscriptions(listInput)
                .pipe(Effect.provideService(CurrentSession, validSession))
            ).toHaveLength(0);
          })
      );
      it.effect("lists only the authenticated public subscriber", () =>
        Effect.gen(function* () {
          const handlers = yield* PostSubscriptionRpcHandlersEffect;
          const f = yield* fixture("PUBLIC");
          const db = yield* currentDb;
          const listInput = {
            organizationId: f.organizationId,
            slug: f.postSlug,
          };
          const mutationInput = {
            organizationId: f.organizationId,
            postId: f.postId,
          };
          const otherUserId = `other_${f.organizationId}`;
          const otherSession: Session = {
            ...session(f, false),
            user: {
              id: otherUserId,
              email: "other@example.com",
              name: "Other user",
              restrictedToOrganizationId: null,
            },
            session: { userId: otherUserId, token: "other-token" },
          };
          yield* db.insert(schema.userTable).values({
            id: otherUserId,
            email: "other@example.com",
            name: "Other user",
          });
          expect(
            yield* handlers
              .CreatePostSubscriptionPublic(mutationInput)
              .pipe(Effect.provideService(CurrentSession, session(f, false)))
          ).toEqual({ subscribed: true });
          yield* handlers
            .CreatePostSubscriptionPublic(mutationInput)
            .pipe(Effect.provideService(CurrentSession, otherSession));
          expect(
            yield* handlers
              .ListPostSubscriptionsPublic(listInput)
              .pipe(Effect.provideService(CurrentSession, session(f, false)))
          ).toMatchObject([{ userId: f.userId, memberId: null }]);
          expect(
            yield* handlers
              .ListPostSubscriptionsPublic(listInput)
              .pipe(Effect.provideService(CurrentSession, session(f, false)))
          ).toHaveLength(1);
        })
      );
      // This endpoint runs on `PublicAuthMiddleware`, which admits the
      // restricted sessions widget SSO mints. Without the organization-scope
      // policy a restricted session could name any workspace.
      it.effect(
        "refuses a restricted session asking about another organization",
        () =>
          Effect.gen(function* () {
            const handlers = yield* PostSubscriptionRpcHandlersEffect;
            const f = yield* fixture();
            const listInput = {
              organizationId: f.organizationId,
              slug: f.postSlug,
            };

            const error = yield* Effect.flip(
              handlers
                .ListPostSubscriptionsPublic(listInput)
                .pipe(
                  Effect.provideService(
                    CurrentSession,
                    session(f, true, "org_somewhere_else")
                  )
                )
            );

            expect(error._tag).toBe("PolicyDenied");
          })
      );

      it.effect("allows a restricted session inside its own organization", () =>
        Effect.gen(function* () {
          const handlers = yield* PostSubscriptionRpcHandlersEffect;
          const f = yield* fixture();
          yield* handlers
            .CreatePostSubscription({
              organizationId: f.organizationId,
              postId: f.postId,
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                session(f, true, f.organizationId)
              )
            );

          expect(
            yield* handlers
              .ListPostSubscriptionsPublic({
                organizationId: f.organizationId,
                slug: f.postSlug,
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  session(f, true, f.organizationId)
                )
              )
          ).toHaveLength(1);
        })
      );

      it.effect(
        "hides subscribers of private board posts from the public endpoint",
        () =>
          Effect.gen(function* () {
            const handlers = yield* PostSubscriptionRpcHandlersEffect;
            const f = yield* fixture("PRIVATE");
            yield* grantStarterPlan(f.organizationId);
            const listInput = {
              organizationId: f.organizationId,
              slug: f.postSlug,
            };
            const mutationInput = {
              organizationId: f.organizationId,
              postId: f.postId,
            };
            yield* handlers
              .CreatePostSubscription(mutationInput)
              .pipe(Effect.provideService(CurrentSession, session(f)));
            expect(
              yield* handlers
                .ListPostSubscriptionsPublic(listInput)
                .pipe(Effect.provideService(CurrentSession, session(f)))
            ).toHaveLength(0);
          })
      );
    }
  );
});
