import { createHash } from "node:crypto";

import { NodeCrypto } from "@effect/platform-node";
import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  BoardId,
  type LegidOf,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import { IntegrationEventRecorder } from "@feeblo/integration-core";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { BoardRepository } from "../board/repository";
import { EmailOutboxConfig } from "../email-outbox/config";
import { EmailOutboxRepository } from "../email-outbox/repository";
import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { EmailSubscriptionTokenService } from "../email-subscription/tokens";
import { EntitlementPolicy } from "../entitlement/policies";
import { ResolvePrincipalService } from "../identity/service";
import { PostActivityRepository } from "../post-activity/repository";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import { S3Test } from "../services/s3-test";
import { CurrentSession, type Session } from "../session-middleware";
import { UserRepository } from "../user/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { PostRpcHandlersEffect } from "./handlers";
import { PostPolicy } from "./policies";
import { PostRepository } from "./repository";

describe("PostRpcHandlers on-behalf", () => {
  const recordedIntegrationEvents: unknown[] = [];
  type Role = Session["memberships"][number]["role"];

  type Fixture = {
    boardId: LegidOf<"BoardId">;
    membershipId: string;
    organizationId: LegidOf<"WorkspaceId">;
    statusId: LegidOf<"PostStatusId">;
    userEmail: string;
    userId: string;
  };

  const hashEmail = (email: string): string =>
    createHash("sha256").update(email.toLowerCase().trim()).digest("hex");

  const makeFixture = (role: Role = "manager") =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const boardId = yield* BoardId.generate;
      const statusId = yield* PostStatusId.generate;
      const userId = `user_${organizationId}`;
      const userEmail = `${organizationId}@example.com`;
      const membershipId = `membership_${organizationId}`;
      const now = new Date();

      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Test organization",
        slug: organizationId,
        createdAt: now,
      });
      yield* db.insert(schema.userTable).values({
        id: userId,
        email: userEmail,
        name: "Staff Actor",
        emailVerified: true,
      });
      yield* db.insert(schema.memberTable).values({
        id: membershipId,
        organizationId,
        userId,
        role,
        createdAt: now,
      });
      yield* db.insert(schema.boardTable).values({
        id: boardId,
        name: "Test board",
        slug: boardId,
        visibility: "PUBLIC",
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

      return {
        boardId,
        membershipId,
        organizationId,
        statusId,
        userEmail,
        userId,
      } satisfies Fixture;
    });

  const makeSession = (fixture: Fixture, role: Role | null): Session => ({
    user: {
      id: fixture.userId,
      email: fixture.userEmail,
      name: "Staff Actor",
      restrictedToOrganizationId: null,
    },
    session: { userId: fixture.userId, token: "test-token" },
    organizations: [{ id: fixture.organizationId }],
    memberships: role
      ? [
          {
            membershipId: fixture.membershipId,
            organizationId: fixture.organizationId,
            role,
          },
        ]
      : [],
  });

  const postCreateInput = (
    fixture: Fixture,
    id: LegidOf<"PostId">,
    title: string
  ) => ({
    assetIds: [],
    id,
    organizationId: fixture.organizationId,
    boardId: fixture.boardId,
    statusId: fixture.statusId,
    title,
    content: title,
  });

  /** A real, email-verified feeblo account that resolve-by-email can adopt. */
  const insertVerifiedUser = (args: { id: string; email: string }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.userTable).values({
        id: args.id,
        name: "Jane Customer",
        email: args.email,
        emailHash: hashEmail(args.email),
        emailVerified: true,
      });
    });

  const getPost = (postId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const [post] = yield* db
        .select()
        .from(schema.postTable)
        .where(eq(schema.postTable.id, postId))
        .limit(1);
      return post;
    });

  const RepositoriesTest = Layer.mergeAll(
    BoardRepository.layer,
    PostRepository.layer,
    PostActivityRepository.layer,
    PostSubscriptionRepository.layer,
    EmailOutboxRepository.layer,
    EmailSubscriptionRepository.layerWithoutDependencies.pipe(
      Layer.provide(
        EmailSubscriptionTokenService.layerTest(
          "post-on-behalf-test-signing-secret"
        )
      )
    ),
    ResolvePrincipalService.layer,
    UserRepository.layer,
    WorkspaceRepository.layer
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));

  const HandlerTest = Layer.mergeAll(
    PostPolicy.layer,
    EntitlementPolicy.layer
  ).pipe(Layer.provideMerge(RepositoriesTest));

  const TestLayer = Layer.mergeAll(
    HandlerTest,
    Database.PgliteDatabaseLive,
    NodeCrypto.layer,
    S3Test,
    EmailOutboxConfig.layerTest(new URL("https://feeblo.test")),
    Layer.succeed(
      IntegrationEventRecorder,
      IntegrationEventRecorder.of({
        recordIntegrationEvent: ({ event }) =>
          Effect.sync(() => {
            recordedIntegrationEvents.push(event);
          }).pipe(Effect.as({ deliveryCount: 0, eventRecorded: false })),
      })
    )
  );

  layer(TestLayer)("handlers", (it) => {
    describe("PostCreate with author", () => {
      it.effect(
        "attributes the post to the resolved contact with provenance",
        () =>
          Effect.gen(function* () {
            recordedIntegrationEvents.length = 0;
            const handlers = yield* PostRpcHandlersEffect;
            const fixture = yield* makeFixture("manager");
            const postId = yield* PostId.generate;

            yield* handlers
              .PostCreate({
                ...postCreateInput(fixture, postId, "On behalf feedback"),
                author: { email: "jane@example.com", name: "Jane Doe" },
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, "manager")
                )
              );

            const post = yield* getPost(postId);
            expect(post).toMatchObject({
              creatorId: null,
              creatorMemberId: null,
            });
            expect(post?.contactId).not.toBeNull();

            const db = yield* currentDb;
            const [storedContact] = yield* db
              .select()
              .from(schema.contactTable)
              .where(eq(schema.contactTable.id, post!.contactId!))
              .limit(1);
            expect(storedContact).toMatchObject({
              email: "jane@example.com",
              name: "Jane Doe",
            });

            const [activity] = yield* db
              .select()
              .from(schema.postActivityTable)
              .where(
                and(
                  eq(schema.postActivityTable.postId, postId),
                  eq(schema.postActivityTable.kind, "POST_CREATED")
                )
              )
              .limit(1);
            expect(activity).toMatchObject({
              actorId: fixture.userId,
              actorMemberId: fixture.membershipId,
              metadata: { onBehalfOf: { contactId: post?.contactId } },
            });

            // The integration event keeps the staff member as actor.
            expect(recordedIntegrationEvents).toEqual([
              expect.objectContaining({
                type: "feedback.post.created",
                data: expect.objectContaining({
                  actor: expect.objectContaining({
                    kind: "member",
                    memberId: fixture.membershipId,
                  }),
                }),
              }),
            ]);

            // The submission notification intent keeps the admin as actor.
            const intents = yield* db
              .select({ kind: schema.emailOutboxTable.kind })
              .from(schema.emailOutboxTable)
              .where(eq(schema.emailOutboxTable.aggregateId, postId));
            expect(intents.map((intent) => intent.kind)).toEqual([
              "submission.created",
            ]);
          })
      );

      it.effect(
        "subscribes a verified-account subject through the trusted path",
        () =>
          Effect.gen(function* () {
            recordedIntegrationEvents.length = 0;
            const handlers = yield* PostRpcHandlersEffect;
            const repository = yield* EmailSubscriptionRepository;
            const db = yield* currentDb;
            const fixture = yield* makeFixture("manager");
            yield* insertVerifiedUser({
              id: "user_jane_verified",
              email: "jane@example.com",
            });
            const postId = yield* PostId.generate;

            yield* handlers
              .PostCreate({
                ...postCreateInput(fixture, postId, "Verified author"),
                author: { email: "jane@example.com" },
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, "manager")
                )
              );

            const post = yield* getPost(postId);
            expect(post?.creatorId).toBe("user_jane_verified");
            expect(post?.creatorMemberId).toBeNull();

            const subscription = yield* repository.findSubscription({
              email: "jane@example.com",
              organizationId: fixture.organizationId,
              topic: { topicId: postId, topicType: "post" },
            });
            expect(Option.getOrUndefined(subscription)).toMatchObject({
              source: "post_creator",
              state: "active",
            });

            const [emailContact] = yield* db
              .select()
              .from(schema.emailContactTable)
              .where(
                and(
                  eq(
                    schema.emailContactTable.organizationId,
                    fixture.organizationId
                  ),
                  eq(schema.emailContactTable.email, "jane@example.com")
                )
              )
              .limit(1);
            expect(emailContact).toMatchObject({
              verificationState: "verified",
              userId: "user_jane_verified",
            });

            // In-app watch-list parity for the attributed author; the staff
            // actor is not subscribed.
            const subscriptions = yield* db
              .select({ userId: schema.postSubscriptionTable.userId })
              .from(schema.postSubscriptionTable)
              .where(eq(schema.postSubscriptionTable.postId, postId));
            expect(subscriptions).toEqual([{ userId: "user_jane_verified" }]);
          })
      );

      it.effect(
        "defers subscriptions for a shadow-only subject without emailing",
        () =>
          Effect.gen(function* () {
            recordedIntegrationEvents.length = 0;
            const handlers = yield* PostRpcHandlersEffect;
            const resolver = yield* ResolvePrincipalService;
            const repository = yield* EmailSubscriptionRepository;
            const db = yield* currentDb;
            const fixture = yield* makeFixture("manager");

            // Provision the shadow identity up front (as votes/comments would).
            const resolved = yield* resolver.resolve({
              organizationId: fixture.organizationId,
              needsUser: true,
              subject: { email: "sam@example.com", name: "Sam Shadow" },
            });
            const shadowUserId = resolved.userId!;
            const [shadow] = yield* db
              .select()
              .from(schema.userTable)
              .where(eq(schema.userTable.id, shadowUserId))
              .limit(1);
            expect(shadow?.emailVerified).toBe(false);

            const postId = yield* PostId.generate;
            yield* handlers
              .PostCreate({
                ...postCreateInput(fixture, postId, "Shadow author"),
                author: { email: "sam@example.com" },
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, "manager")
                )
              );

            const post = yield* getPost(postId);
            expect(post?.creatorId).toBe(shadowUserId);

            const subscription = yield* repository.findSubscription({
              email: "sam@example.com",
              organizationId: fixture.organizationId,
              topic: { topicId: postId, topicType: "post" },
            });
            expect(Option.getOrUndefined(subscription)).toMatchObject({
              source: "post_creator",
              state: "deferred_no_access",
              verifiedAt: null,
              verificationExpiresAt: null,
            });

            // Zero emails: no verification request was recorded anywhere.
            const verificationIntents = yield* db
              .select({ id: schema.emailOutboxTable.id })
              .from(schema.emailOutboxTable)
              .where(
                eq(
                  schema.emailOutboxTable.kind,
                  "subscription.verification_requested"
                )
              );
            expect(verificationIntents).toEqual([]);

            // In-app watch-list parity still applies to the shadow user.
            const subscriptions = yield* db
              .select({ userId: schema.postSubscriptionTable.userId })
              .from(schema.postSubscriptionTable)
              .where(eq(schema.postSubscriptionTable.postId, postId));
            expect(subscriptions).toEqual([{ userId: shadowUserId }]);
          })
      );

      it.effect("defers a bare-email subject that has no user at all", () =>
        Effect.gen(function* () {
          recordedIntegrationEvents.length = 0;
          const handlers = yield* PostRpcHandlersEffect;
          const repository = yield* EmailSubscriptionRepository;
          const db = yield* currentDb;
          const fixture = yield* makeFixture("manager");
          const postId = yield* PostId.generate;

          yield* handlers
            .PostCreate({
              ...postCreateInput(fixture, postId, "Bare email author"),
              author: { email: "chris@example.com" },
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            );

          const post = yield* getPost(postId);
          expect(post?.creatorId).toBeNull();
          expect(post?.contactId).not.toBeNull();

          const subscription = yield* repository.findSubscription({
            email: "chris@example.com",
            organizationId: fixture.organizationId,
            topic: { topicId: postId, topicType: "post" },
          });
          expect(Option.getOrUndefined(subscription)).toMatchObject({
            source: "post_creator",
            state: "deferred_no_access",
          });

          // No user row exists to watch the post in-app.
          const subscriptions = yield* db
            .select({ id: schema.postSubscriptionTable.id })
            .from(schema.postSubscriptionTable)
            .where(eq(schema.postSubscriptionTable.postId, postId));
          expect(subscriptions).toEqual([]);
        })
      );

      it.effect("denies contributors", () =>
        Effect.gen(function* () {
          recordedIntegrationEvents.length = 0;
          const handlers = yield* PostRpcHandlersEffect;
          const db = yield* currentDb;
          const fixture = yield* makeFixture("contributor");
          const postId = yield* PostId.generate;

          const error = yield* Effect.flip(
            handlers
              .PostCreate({
                ...postCreateInput(fixture, postId, "Contributor on behalf"),
                author: { email: "jane@example.com" },
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, "contributor")
                )
              )
          );
          expect(error._tag).toBe("PolicyDenied");

          const posts = yield* db
            .select({ id: schema.postTable.id })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, postId));
          expect(posts).toEqual([]);
        })
      );

      it.effect("allows owners and admins by inheritance", () =>
        Effect.gen(function* () {
          recordedIntegrationEvents.length = 0;
          const handlers = yield* PostRpcHandlersEffect;
          for (const role of ["owner", "admin"] as const) {
            const fixture = yield* makeFixture(role);
            const postId = yield* PostId.generate;
            yield* handlers
              .PostCreate({
                ...postCreateInput(fixture, postId, `${role} on behalf`),
                author: { email: `${role}@example.com` },
              })
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture, role))
              );
            const post = yield* getPost(postId);
            expect(post?.contactId).not.toBeNull();
          }
        })
      );

      it.effect("leaves no-author creation untouched for every role", () =>
        Effect.gen(function* () {
          recordedIntegrationEvents.length = 0;
          const handlers = yield* PostRpcHandlersEffect;
          for (const role of [
            "contributor",
            "manager",
            "admin",
            "owner",
          ] as const) {
            const fixture = yield* makeFixture(role);
            const postId = yield* PostId.generate;
            yield* handlers
              .PostCreate(postCreateInput(fixture, postId, `${role} self post`))
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture, role))
              );

            const post = yield* getPost(postId);
            expect(post).toMatchObject({
              creatorId: fixture.userId,
              creatorMemberId: fixture.membershipId,
              contactId: null,
            });

            const db = yield* currentDb;
            const [activity] = yield* db
              .select({ metadata: schema.postActivityTable.metadata })
              .from(schema.postActivityTable)
              .where(
                and(
                  eq(schema.postActivityTable.postId, postId),
                  eq(schema.postActivityTable.kind, "POST_CREATED")
                )
              )
              .limit(1);
            expect(activity?.metadata).toBeNull();
          }
        })
      );
    });

    describe("PostCreatePublic", () => {
      it.effect("rejects an author with a bad request", () =>
        Effect.gen(function* () {
          recordedIntegrationEvents.length = 0;
          const handlers = yield* PostRpcHandlersEffect;
          const db = yield* currentDb;
          const fixture = yield* makeFixture();
          const postId = yield* PostId.generate;

          const error = yield* Effect.flip(
            handlers
              .PostCreatePublic({
                ...postCreateInput(fixture, postId, "Public on behalf"),
                author: { email: "jane@example.com" },
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, null)
                )
              )
          );
          expect(error._tag).toBe("BadRequestError");

          const posts = yield* db
            .select({ id: schema.postTable.id })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, postId));
          expect(posts).toEqual([]);
        })
      );
    });
  });
});
