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
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { EmailSubscriptionTokenService } from "../email-subscription/tokens";
import { ResolvePrincipalService } from "../identity/service";
import { PostActivityRepository } from "../post-activity/repository";
import { PostRepository } from "../post/repository";
import { CurrentSession, type Session } from "../session-middleware";
import { UserRepository } from "../user/repository";
import { UpvoteRpcHandlersEffect } from "./handlers";
import { UpvotePolicy } from "./policies";
import { UpvoteRepository } from "./repository";

describe("UpvoteRpcHandlers on-behalf", () => {
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

  const createPost = (fixture: Fixture, id: LegidOf<"PostId">) =>
    Effect.gen(function* () {
      const repository = yield* PostRepository;
      yield* repository.create({
        id,
        boardId: fixture.boardId,
        organizationId: fixture.organizationId,
        statusId: fixture.statusId,
        title: "On-behalf voter post",
        content: "On-behalf voter post",
        creatorId: fixture.userId,
        creatorMemberId: fixture.membershipId,
      });
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

  const getUpvotes = (postId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      return yield* db
        .select()
        .from(schema.upvoteTable)
        .where(eq(schema.upvoteTable.postId, postId));
    });

  const getActivities = (postId: string, kind: "VOTE_ADDED" | "VOTE_REMOVED") =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      return yield* db
        .select()
        .from(schema.postActivityTable)
        .where(
          and(
            eq(schema.postActivityTable.postId, postId),
            eq(schema.postActivityTable.kind, kind)
          )
        );
    });

  const RepositoriesTest = Layer.mergeAll(
    PostRepository.layer,
    UpvoteRepository.layer,
    PostActivityRepository.layer,
    EmailSubscriptionRepository.layerWithoutDependencies.pipe(
      Layer.provide(
        EmailSubscriptionTokenService.layerTest(
          "upvote-on-behalf-test-signing-secret"
        )
      )
    ),
    ResolvePrincipalService.layer,
    UserRepository.layer
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));

  const HandlerTest = UpvotePolicy.layer.pipe(
    Layer.provideMerge(RepositoriesTest)
  );

  const TestLayer = Layer.mergeAll(
    HandlerTest,
    Database.PgliteDatabaseLive,
    NodeCrypto.layer
  );

  layer(TestLayer)("handlers", (it) => {
    describe("UpvoteAddOnBehalf", () => {
      it.effect(
        "provisions a shadow user for an email-only subject and links the contact",
        () =>
          Effect.gen(function* () {
            const handlers = yield* UpvoteRpcHandlersEffect;
            const db = yield* currentDb;
            const fixture = yield* makeFixture("manager");
            const postId = yield* PostId.generate;
            yield* createPost(fixture, postId);

            const result = yield* handlers
              .UpvoteAddOnBehalf({
                organizationId: fixture.organizationId,
                postId,
                author: { email: "sam@example.com", name: "Sam Shadow" },
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, "manager")
                )
              );
            expect(result.added).toBe(true);

            const upvotes = yield* getUpvotes(postId);
            expect(upvotes).toHaveLength(1);
            const shadowUserId = upvotes[0]!.userId;
            expect(upvotes[0]).toMatchObject({
              organizationId: fixture.organizationId,
              memberId: null,
            });

            // The vote needs a user row: a shadow user was provisioned and
            // linked to the resolved contact.
            const [shadow] = yield* db
              .select()
              .from(schema.userTable)
              .where(eq(schema.userTable.id, shadowUserId))
              .limit(1);
            expect(shadow?.email).toMatch(/^behalf-[0-9a-f]+@feeblo\.com$/);
            expect(shadow?.emailVerified).toBe(false);

            const [contact] = yield* db
              .select()
              .from(schema.contactTable)
              .where(
                and(
                  eq(
                    schema.contactTable.organizationId,
                    fixture.organizationId
                  ),
                  eq(schema.contactTable.email, "sam@example.com")
                )
              )
              .limit(1);
            expect(contact?.userId).toBe(shadowUserId);
          })
      );

      it.effect("is idempotent for an existing vote", () =>
        Effect.gen(function* () {
          const handlers = yield* UpvoteRpcHandlersEffect;
          const fixture = yield* makeFixture("manager");
          const postId = yield* PostId.generate;
          yield* createPost(fixture, postId);

          const args = {
            organizationId: fixture.organizationId,
            postId,
            author: { email: "sam@example.com" },
          } as const;
          const session = makeSession(fixture, "manager");
          const first = yield* handlers
            .UpvoteAddOnBehalf(args)
            .pipe(Effect.provideService(CurrentSession, session));
          const second = yield* handlers
            .UpvoteAddOnBehalf(args)
            .pipe(Effect.provideService(CurrentSession, session));

          expect(first.added).toBe(true);
          expect(second.added).toBe(false);

          const upvotes = yield* getUpvotes(postId);
          expect(upvotes).toHaveLength(1);

          // The no-op records no duplicate activity.
          const activities = yield* getActivities(postId, "VOTE_ADDED");
          expect(activities).toHaveLength(1);
        })
      );

      it.effect(
        "subscribes a verified-account subject through the trusted path",
        () =>
          Effect.gen(function* () {
            const handlers = yield* UpvoteRpcHandlersEffect;
            const emailSubscriptions = yield* EmailSubscriptionRepository;
            const fixture = yield* makeFixture("manager");
            yield* insertVerifiedUser({
              id: "user_jane_verified",
              email: "jane@example.com",
            });
            const postId = yield* PostId.generate;
            yield* createPost(fixture, postId);

            const result = yield* handlers
              .UpvoteAddOnBehalf({
                organizationId: fixture.organizationId,
                postId,
                author: { email: "jane@example.com" },
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, "manager")
                )
              );
            expect(result.added).toBe(true);

            // No shadow was created: the verified account is adopted.
            const upvotes = yield* getUpvotes(postId);
            expect(upvotes).toHaveLength(1);
            expect(upvotes[0]?.userId).toBe("user_jane_verified");

            const subscription = yield* emailSubscriptions.findSubscription({
              email: "jane@example.com",
              organizationId: fixture.organizationId,
              topic: { topicId: postId, topicType: "post" },
            });
            expect(Option.getOrUndefined(subscription)).toMatchObject({
              source: "admin_added_voter",
              state: "active",
            });
          })
      );

      it.effect("defers the subscription for an email-only subject", () =>
        Effect.gen(function* () {
          const handlers = yield* UpvoteRpcHandlersEffect;
          const emailSubscriptions = yield* EmailSubscriptionRepository;
          const db = yield* currentDb;
          const fixture = yield* makeFixture("manager");
          const postId = yield* PostId.generate;
          yield* createPost(fixture, postId);

          yield* handlers
            .UpvoteAddOnBehalf({
              organizationId: fixture.organizationId,
              postId,
              author: { email: "sam@example.com" },
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            );

          const subscription = yield* emailSubscriptions.findSubscription({
            email: "sam@example.com",
            organizationId: fixture.organizationId,
            topic: { topicId: postId, topicType: "post" },
          });
          expect(Option.getOrUndefined(subscription)).toMatchObject({
            source: "admin_added_voter",
            state: "deferred_no_access",
            verifiedAt: null,
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
        })
      );

      it.effect("records provenance activity with the staff actor", () =>
        Effect.gen(function* () {
          const handlers = yield* UpvoteRpcHandlersEffect;
          const fixture = yield* makeFixture("manager");
          const postId = yield* PostId.generate;
          yield* createPost(fixture, postId);

          yield* handlers
            .UpvoteAddOnBehalf({
              organizationId: fixture.organizationId,
              postId,
              author: { email: "sam@example.com", name: "Sam Shadow" },
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            );

          const activities = yield* getActivities(postId, "VOTE_ADDED");
          expect(activities).toHaveLength(1);
          const upvotes = yield* getUpvotes(postId);
          expect(activities[0]).toMatchObject({
            actorId: fixture.userId,
            actorMemberId: fixture.membershipId,
            metadata: {
              onBehalfOf: {
                contactId: expect.any(String),
                userId: upvotes[0]?.userId,
              },
            },
          });
        })
      );

      it.effect(
        "sets memberId only when the resolved subject is an org member",
        () =>
          Effect.gen(function* () {
            const handlers = yield* UpvoteRpcHandlersEffect;
            const fixture = yield* makeFixture("manager");
            const postId = yield* PostId.generate;
            yield* createPost(fixture, postId);

            // The staff actor votes as themselves via their own subject.
            yield* handlers
              .UpvoteAddOnBehalf({
                organizationId: fixture.organizationId,
                postId,
                author: { userId: fixture.userId },
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, "manager")
                )
              );

            const upvotes = yield* getUpvotes(postId);
            expect(upvotes).toHaveLength(1);
            expect(upvotes[0]).toMatchObject({
              userId: fixture.userId,
              memberId: fixture.membershipId,
            });
          })
      );

      it.effect("allows contributors", () =>
        Effect.gen(function* () {
          const handlers = yield* UpvoteRpcHandlersEffect;
          const fixture = yield* makeFixture("contributor");
          const postId = yield* PostId.generate;
          yield* createPost(fixture, postId);

          const result = yield* handlers
            .UpvoteAddOnBehalf({
              organizationId: fixture.organizationId,
              postId,
              author: { email: "sam@example.com" },
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "contributor")
              )
            );
          expect(result.added).toBe(true);
        })
      );

      it.effect("denies sessions without a membership", () =>
        Effect.gen(function* () {
          const handlers = yield* UpvoteRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const postId = yield* PostId.generate;
          yield* createPost(fixture, postId);

          // These RPCs are dashboard-only (AuthMiddleware); a caller without
          // an organization membership never gets past the policy.
          const error = yield* Effect.flip(
            handlers
              .UpvoteAddOnBehalf({
                organizationId: fixture.organizationId,
                postId,
                author: { email: "sam@example.com" },
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, null)
                )
              )
          );
          expect(error._tag).toBe("PolicyDenied");

          const upvotes = yield* getUpvotes(postId);
          expect(upvotes).toEqual([]);
        })
      );

      it.effect("surfaces SubjectNotFoundError for an unknown contact", () =>
        Effect.gen(function* () {
          const handlers = yield* UpvoteRpcHandlersEffect;
          const fixture = yield* makeFixture("manager");
          const postId = yield* PostId.generate;
          yield* createPost(fixture, postId);

          const error = yield* Effect.flip(
            handlers
              .UpvoteAddOnBehalf({
                organizationId: fixture.organizationId,
                postId,
                author: { contactId: "cnt_does_not_exist" },
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, "manager")
                )
              )
          );
          expect(error._tag).toBe("SubjectNotFoundError");

          const upvotes = yield* getUpvotes(postId);
          expect(upvotes).toEqual([]);
        })
      );
    });

    describe("UpvoteRemoveOnBehalf", () => {
      it.effect("removes exactly the subject's vote with provenance", () =>
        Effect.gen(function* () {
          const handlers = yield* UpvoteRpcHandlersEffect;
          const fixture = yield* makeFixture("manager");
          const postId = yield* PostId.generate;
          yield* createPost(fixture, postId);

          yield* handlers
            .UpvoteAddOnBehalf({
              organizationId: fixture.organizationId,
              postId,
              author: { email: "sam@example.com" },
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            );
          const upvotes = yield* getUpvotes(postId);
          const shadowUserId = upvotes[0]!.userId;

          const result = yield* handlers
            .UpvoteRemoveOnBehalf({
              organizationId: fixture.organizationId,
              postId,
              userId: shadowUserId,
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            );
          expect(result.removed).toBe(true);

          expect((yield* getUpvotes(postId)).map((row) => row.id)).toEqual([]);

          const activities = yield* getActivities(postId, "VOTE_REMOVED");
          expect(activities).toHaveLength(1);
          expect(activities[0]).toMatchObject({
            actorId: fixture.userId,
            actorMemberId: fixture.membershipId,
          });
          // Remove-by-userId has no contact to attribute; none is invented.
          expect(activities[0]?.metadata).toEqual({
            onBehalfOf: { userId: shadowUserId },
          });
        })
      );

      it.effect("is a no-op for a non-voter", () =>
        Effect.gen(function* () {
          const handlers = yield* UpvoteRpcHandlersEffect;
          const fixture = yield* makeFixture("manager");
          const postId = yield* PostId.generate;
          yield* createPost(fixture, postId);

          const result = yield* handlers
            .UpvoteRemoveOnBehalf({
              organizationId: fixture.organizationId,
              postId,
              userId: "user_never_voted",
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            );
          expect(result.removed).toBe(false);

          const activities = yield* getActivities(postId, "VOTE_REMOVED");
          expect(activities).toEqual([]);
        })
      );

      it.effect("does not touch the email subscription", () =>
        Effect.gen(function* () {
          const handlers = yield* UpvoteRpcHandlersEffect;
          const emailSubscriptions = yield* EmailSubscriptionRepository;
          const fixture = yield* makeFixture("manager");
          yield* insertVerifiedUser({
            id: "user_jane_remove",
            email: "jane-remove@example.com",
          });
          const postId = yield* PostId.generate;
          yield* createPost(fixture, postId);

          yield* handlers
            .UpvoteAddOnBehalf({
              organizationId: fixture.organizationId,
              postId,
              author: { email: "jane-remove@example.com" },
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            );
          yield* handlers
            .UpvoteRemoveOnBehalf({
              organizationId: fixture.organizationId,
              postId,
              userId: "user_jane_remove",
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            );

          // Unsubscribing stays explicit; removing a voter keeps the
          // subscription exactly as it was.
          const subscription = yield* emailSubscriptions.findSubscription({
            email: "jane-remove@example.com",
            organizationId: fixture.organizationId,
            topic: { topicId: postId, topicType: "post" },
          });
          expect(Option.getOrUndefined(subscription)).toMatchObject({
            source: "admin_added_voter",
            state: "active",
          });
        })
      );

      it.effect("denies sessions without a membership", () =>
        Effect.gen(function* () {
          const handlers = yield* UpvoteRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const postId = yield* PostId.generate;
          yield* createPost(fixture, postId);

          const error = yield* Effect.flip(
            handlers
              .UpvoteRemoveOnBehalf({
                organizationId: fixture.organizationId,
                postId,
                userId: "user_someone",
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, null)
                )
              )
          );
          expect(error._tag).toBe("PolicyDenied");
        })
      );
    });
  });
});
