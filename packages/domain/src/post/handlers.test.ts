import { NodeCrypto } from "@effect/platform-node";
import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  BoardId,
  CommentId,
  type LegidOf,
  PostId,
  PostStatusId,
  UpvoteId,
  WorkspaceId,
} from "@feeblo/id";
import { IntegrationEventRecorder } from "@feeblo/integration-core";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { TestClock } from "effect/testing";

import { BoardRepository } from "../board/repository";
import { EmailOutboxConfig } from "../email-outbox/config";
import { EmailOutboxRepository } from "../email-outbox/repository";
import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { EmailSubscriptionTokenService } from "../email-subscription/tokens";
import { EntitlementPolicy } from "../entitlement/policies";
import { PostActivityRepository } from "../post-activity/repository";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import { BadRequestError } from "../rpc-errors";
import { S3Test } from "../services/s3-test";
import {
  CurrentSession,
  OptionalCurrentSession,
  type Session,
} from "../session-middleware";
import { WorkspaceRepository } from "../workspace/repository";
import {
  DEFAULT_POST_EMBEDDING_DIMENSIONS,
  DEFAULT_POST_EMBEDDING_MODEL,
  PostEmbeddingService,
} from "./embedding-service";
import { PostNotFoundError } from "./errors";
import { PostRpcHandlersEffect } from "./handlers";
import { PostPolicy } from "./policies";
import { PostRepository } from "./repository";

describe("PostRpcHandlers", () => {
  const recordedIntegrationEvents: unknown[] = [];
  type Fixture = {
    boardId: LegidOf<"BoardId">;
    creatorEmail: string;
    membershipId: string;
    organizationId: LegidOf<"WorkspaceId">;
    statusId: LegidOf<"PostStatusId">;
    userId: string;
  };

  const makeSession = (
    fixture: Fixture,
    role: Session["memberships"][number]["role"] | null = "owner"
  ): Session => ({
    user: {
      id: fixture.userId,
      email: fixture.creatorEmail,
      name: "Test User",
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

  const makeFixture = (visibility: "PUBLIC" | "PRIVATE" = "PUBLIC") =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const boardId = yield* BoardId.generate;
      const statusId = yield* PostStatusId.generate;
      const userId = `user_${organizationId}`;
      const creatorEmail = `${organizationId}@example.com`;
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
        email: creatorEmail,
        name: "Test User",
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
        name: "Test board",
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

      return {
        boardId,
        creatorEmail,
        membershipId,
        organizationId,
        statusId,
        userId,
      } satisfies Fixture;
    });

  const postCreateInput = (
    fixture: Fixture,
    id: LegidOf<"PostId">,
    title: string,
    content = title
  ) => ({
    assetIds: [],
    id,
    organizationId: fixture.organizationId,
    boardId: fixture.boardId,
    statusId: fixture.statusId,
    title,
    content,
  });

  const addBoard = (fixture: Fixture, visibility: "PUBLIC" | "PRIVATE") =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const id = yield* BoardId.generate;
      const now = new Date();

      yield* db.insert(schema.boardTable).values({
        id,
        name: `${visibility} test board`,
        slug: id,
        visibility,
        organizationId: fixture.organizationId,
        creatorId: fixture.userId,
        creatorMemberId: fixture.membershipId,
        createdAt: now,
        updatedAt: now,
      });

      return id;
    });

  const addStatus = (
    fixture: Fixture,
    type: "PENDING" | "IN_PROGRESS" | "COMPLETED" = "COMPLETED"
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const id = yield* PostStatusId.generate;

      yield* db.insert(schema.postStatusTable).values({
        id,
        type,
        orderIndex: 1,
        organizationId: fixture.organizationId,
      });

      return id;
    });

  const activateStarterPlan = (organizationId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const now = new Date();
      const productId = `product_${organizationId}`;
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
          "post-handler-test-signing-secret"
        )
      )
    ),
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
    describe("PostList", () => {
      it.effect("rejects users without a membership", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const error = yield* Effect.flip(
            handlers
              .PostList({
                organizationId: fixture.organizationId,
                boardId: fixture.boardId,
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

    describe("PostCreatePublic", () => {
      it.effect(
        "allows non-members to create on public boards and exposes the post publicly",
        () =>
          Effect.gen(function* () {
            const handlers = yield* PostRpcHandlersEffect;
            const fixture = yield* makeFixture("PUBLIC");
            const postId = yield* PostId.generate;

            yield* handlers
              .PostCreatePublic(
                postCreateInput(
                  fixture,
                  postId,
                  "Public feedback",
                  "A public idea"
                )
              )
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, null)
                )
              );

            const posts = yield* handlers
              .PostListPublic({
                organizationId: fixture.organizationId,
                boardId: fixture.boardId,
              })
              .pipe(
                Effect.provideService(OptionalCurrentSession, Option.none())
              );

            expect(posts).toHaveLength(1);
            expect(posts[0]).toMatchObject({
              id: postId,
              title: "Public feedback",
              // Creator identifiers are redacted for anonymous callers
              // (see `public-actor.ts`); the post itself stays visible.
              creatorId: null,
              creatorMemberId: null,
            });
            expect(posts[0]?.content).toContain("A public idea");
          })
      );

      it.effect("rejects non-members on private boards", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture("PRIVATE");
          const postId = yield* PostId.generate;
          const error = yield* Effect.flip(
            handlers
              .PostCreatePublic(
                postCreateInput(
                  fixture,
                  postId,
                  "Private feedback",
                  "A private idea"
                )
              )
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

    describe("PostCreate", () => {
      it.effect(
        "records equivalent safe creation envelopes for dashboard and public-board posts",
        () =>
          Effect.gen(function* () {
            recordedIntegrationEvents.length = 0;
            const handlers = yield* PostRpcHandlersEffect;
            const fixture = yield* makeFixture("PUBLIC");
            const dashboardPostId = yield* PostId.generate;
            const publicPostId = yield* PostId.generate;

            yield* handlers
              .PostCreate(
                postCreateInput(fixture, dashboardPostId, "Dashboard event")
              )
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );
            yield* handlers
              .PostCreatePublic(
                postCreateInput(fixture, publicPostId, "Public event")
              )
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, null)
                )
              );

            expect(recordedIntegrationEvents).toHaveLength(2);
            expect(recordedIntegrationEvents).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  type: "feedback.post.created",
                  data: expect.objectContaining({
                    actor: expect.objectContaining({ kind: "member" }),
                    board: expect.objectContaining({ id: fixture.boardId }),
                  }),
                }),
                expect.objectContaining({
                  type: "feedback.post.created",
                  data: expect.objectContaining({
                    actor: { kind: "end_user" },
                    board: expect.objectContaining({ id: fixture.boardId }),
                  }),
                }),
              ])
            );
          })
      );

      it.effect(
        "creates an active verified email subscription for the post creator",
        () =>
          Effect.gen(function* () {
            const handlers = yield* PostRpcHandlersEffect;
            const repository = yield* EmailSubscriptionRepository;
            const fixture = yield* makeFixture();
            const postId = yield* PostId.generate;
            yield* handlers
              .PostCreate(
                postCreateInput(fixture, postId, "Creator subscription")
              )
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );

            const subscription = yield* repository.findSubscription({
              email: fixture.creatorEmail,
              organizationId: fixture.organizationId,
              topic: { topicId: postId, topicType: "post" },
            });
            expect(Option.getOrUndefined(subscription)).toMatchObject({
              source: "post_creator",
              state: "active",
            });
          })
      );

      it.effect("rolls back the post when its outbox insertion fails", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const postId = yield* PostId.generate;
          const db = yield* currentDb;
          yield* db.execute(
            sql.raw(`
            CREATE FUNCTION reject_email_outbox_insert() RETURNS trigger AS $$
            BEGIN
              RAISE EXCEPTION 'email outbox unavailable';
            END;
            $$ LANGUAGE plpgsql;
          `)
          );
          yield* db.execute(
            sql.raw(`
            CREATE TRIGGER reject_email_outbox_insert
            BEFORE INSERT ON email_outbox
            FOR EACH ROW EXECUTE FUNCTION reject_email_outbox_insert();
          `)
          );

          yield* Effect.flip(
            handlers
              .PostCreate(postCreateInput(fixture, postId, "Atomic outbox"))
              .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
          ).pipe(
            Effect.ensuring(
              db
                .execute(
                  sql.raw(
                    "DROP TRIGGER reject_email_outbox_insert ON email_outbox"
                  )
                )
                .pipe(
                  Effect.andThen(
                    db.execute(
                      sql.raw("DROP FUNCTION reject_email_outbox_insert()")
                    )
                  ),
                  Effect.orDie
                )
            )
          );

          const posts = yield* db
            .select({ id: schema.postTable.id })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, postId));
          expect(posts).toEqual([]);
        })
      );

      it.effect(
        "records the submission email intent with the post transaction",
        () =>
          Effect.gen(function* () {
            const handlers = yield* PostRpcHandlersEffect;
            const fixture = yield* makeFixture();
            const postId = yield* PostId.generate;
            const db = yield* currentDb;

            yield* handlers
              .PostCreate(postCreateInput(fixture, postId, "Email intent"))
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );

            const intents = yield* db
              .select({
                aggregateId: schema.emailOutboxTable.aggregateId,
                kind: schema.emailOutboxTable.kind,
                organizationId: schema.emailOutboxTable.organizationId,
              })
              .from(schema.emailOutboxTable)
              .where(eq(schema.emailOutboxTable.aggregateId, postId));
            expect(intents).toEqual([
              {
                aggregateId: postId,
                kind: "submission.created",
                organizationId: fixture.organizationId,
              },
            ]);
          })
      );

      it.effect("allows contributors to create posts", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const postId = yield* PostId.generate;

          yield* handlers
            .PostCreate(
              postCreateInput(fixture, postId, "Contributor feedback")
            )
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "contributor")
              )
            );
        })
      );

      it.effect("rejects non-members, including on public boards", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const postId = yield* PostId.generate;
          const error = yield* Effect.flip(
            handlers
              .PostCreate(
                postCreateInput(fixture, postId, "Member-only feedback")
              )
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

      it.effect("deduplicates slug collisions across the organization", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const firstPostId = yield* PostId.generate;
          const secondPostId = yield* PostId.generate;

          yield* handlers
            .PostCreate(
              postCreateInput(fixture, firstPostId, "Duplicate title")
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          yield* handlers
            .PostCreate(
              postCreateInput(fixture, secondPostId, "Duplicate title")
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const db = yield* currentDb;
          const rows = yield* db
            .select({ id: schema.postTable.id, slug: schema.postTable.slug })
            .from(schema.postTable)
            .where(eq(schema.postTable.organizationId, fixture.organizationId))
            .orderBy(schema.postTable.slug);

          expect(rows).toHaveLength(2);
          expect(rows[0]).toMatchObject({
            id: firstPostId,
            slug: "duplicate-title",
          });
          expect(rows[1]).toMatchObject({
            id: secondPostId,
            slug: "duplicate-title-2",
          });
        })
      );

      it.effect(
        "keeps the same slug for identical titles in other organizations",
        () =>
          Effect.gen(function* () {
            const handlers = yield* PostRpcHandlersEffect;
            const firstFixture = yield* makeFixture();
            const secondFixture = yield* makeFixture();
            const firstPostId = yield* PostId.generate;
            const secondPostId = yield* PostId.generate;

            yield* handlers
              .PostCreate(
                postCreateInput(firstFixture, firstPostId, "Shared title")
              )
              .pipe(
                Effect.provideService(CurrentSession, makeSession(firstFixture))
              );
            yield* handlers
              .PostCreate(
                postCreateInput(secondFixture, secondPostId, "Shared title")
              )
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(secondFixture)
                )
              );

            const db = yield* currentDb;
            const rows = yield* db
              .select({ id: schema.postTable.id, slug: schema.postTable.slug })
              .from(schema.postTable)
              .where(inArray(schema.postTable.id, [firstPostId, secondPostId]));

            expect(rows).toHaveLength(2);
            expect(rows[0]).toMatchObject({ slug: "shared-title" });
            expect(rows[1]).toMatchObject({ slug: "shared-title" });
          })
      );

      it.effect("persists an etaQuarter when provided", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const db = yield* currentDb;
          const fixture = yield* makeFixture();
          const postId = yield* PostId.generate;

          yield* handlers
            .PostCreate({
              ...postCreateInput(fixture, postId, "Eta post"),
              etaQuarter: "2026-Q3",
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const [row] = yield* db
            .select({ etaQuarter: schema.postTable.etaQuarter })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, postId));

          expect(row?.etaQuarter).toBe("2026-Q3");
        })
      );
    });

    describe("PostDelete", () => {
      it.effect(
        "reports NotFound when a privileged delete matches no post",
        () =>
          Effect.gen(function* () {
            const handlers = yield* PostRpcHandlersEffect;
            const fixture = yield* makeFixture();
            const missingPostId = yield* PostId.generate;

            const error = yield* Effect.flip(
              handlers
                .PostDelete({
                  id: missingPostId,
                  organizationId: fixture.organizationId,
                  boardId: fixture.boardId,
                })
                .pipe(
                  Effect.provideService(CurrentSession, makeSession(fixture))
                )
            );

            expect(error).toBeInstanceOf(PostNotFoundError);
          })
      );
    });

    describe("PostGetPublic", () => {
      it.effect("returns a public post by slug", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const postId = yield* PostId.generate;

          yield* handlers
            .PostCreate(postCreateInput(fixture, postId, "Slugged feedback"))
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const created = yield* handlers
            .PostList({
              organizationId: fixture.organizationId,
              boardId: fixture.boardId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          const createdPost = created.find((post) => post.id === postId);

          expect(createdPost).toBeDefined();

          const post = yield* handlers
            .PostGetPublic({
              organizationId: fixture.organizationId,
              // SAFETY: The existence check above guarantees the slug.
              slug: createdPost!.slug,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

          expect(post.id).toBe(postId);
          expect(post.title).toBe("Slugged feedback");
        })
      );

      it.effect("does not expose posts from private boards", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const privateBoardId = yield* addBoard(fixture, "PRIVATE");
          const privatePostId = yield* PostId.generate;

          yield* handlers
            .PostCreate({
              ...postCreateInput(fixture, privatePostId, "Private feedback"),
              boardId: privateBoardId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const created = yield* handlers
            .PostList({
              organizationId: fixture.organizationId,
              boardId: privateBoardId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          const privatePost = created.find((post) => post.id === privatePostId);

          expect(privatePost).toBeDefined();

          const error = yield* Effect.flip(
            handlers
              .PostGetPublic({
                organizationId: fixture.organizationId,
                // SAFETY: The existence check above guarantees the slug.
                slug: privatePost!.slug,
              })
              .pipe(
                Effect.provideService(OptionalCurrentSession, Option.none())
              )
          );

          expect(error._tag).toBe("PostNotFoundError");
        })
      );

      it.effect("reports not found for unknown slugs", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");

          const error = yield* Effect.flip(
            handlers
              .PostGetPublic({
                organizationId: fixture.organizationId,
                slug: "no-such-post-slug",
              })
              .pipe(
                Effect.provideService(OptionalCurrentSession, Option.none())
              )
          );

          expect(error._tag).toBe("PostNotFoundError");
        })
      );
    });

    describe("PostListPublic", () => {
      it.effect("does not expose posts from private boards", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const privateBoardId = yield* addBoard(fixture, "PRIVATE");
          const publicPostId = yield* PostId.generate;
          const privatePostId = yield* PostId.generate;

          yield* handlers
            .PostCreate(
              postCreateInput(fixture, publicPostId, "Public feedback")
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          yield* handlers
            .PostCreate({
              ...postCreateInput(fixture, privatePostId, "Private feedback"),
              boardId: privateBoardId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const posts = yield* handlers
            .PostListPublic({
              organizationId: fixture.organizationId,
              boardId: null,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

          expect(posts.map((post) => post.id)).toEqual([publicPostId]);
        })
      );

      it.effect(
        "redacts creator identifiers except for the session user's own posts",
        () =>
          Effect.gen(function* () {
            const handlers = yield* PostRpcHandlersEffect;
            const fixture = yield* makeFixture("PUBLIC");
            const postId = yield* PostId.generate;
            const session = makeSession(fixture);

            yield* handlers
              .PostCreate(
                postCreateInput(fixture, postId, "Identifiable feedback")
              )
              .pipe(Effect.provideService(CurrentSession, session));

            // Anonymous callers get no creator identifiers.
            const [anonymousView] = yield* handlers
              .PostListPublic({
                organizationId: fixture.organizationId,
                boardId: null,
              })
              .pipe(
                Effect.provideService(OptionalCurrentSession, Option.none())
              );

            expect(anonymousView?.creatorId).toBeNull();
            expect(anonymousView?.creatorMemberId).toBeNull();

            // The creator's own view keeps their identifiers so the client
            // can compute "did I create this post".
            const [ownView] = yield* handlers
              .PostListPublic({
                organizationId: fixture.organizationId,
                boardId: null,
              })
              .pipe(
                Effect.provideService(
                  OptionalCurrentSession,
                  Option.some(session)
                )
              );

            expect(ownView?.creatorId).toBe(fixture.userId);
            expect(ownView?.creatorMemberId).toBe(fixture.membershipId);
          })
      );

      it.effect("does not list archived or merged posts", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const activePostId = yield* PostId.generate;
          const archivedPostId = yield* PostId.generate;
          const mergedSourcePostId = yield* PostId.generate;

          for (const [id, title] of [
            [activePostId, "Active feedback"],
            [archivedPostId, "Archived feedback"],
            [mergedSourcePostId, "Merged feedback"],
          ] as const) {
            yield* handlers
              .PostCreate(postCreateInput(fixture, id, title))
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );
          }

          yield* handlers
            .PostAdminUpdate({
              id: archivedPostId,
              organizationId: fixture.organizationId,
              archived: true,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          yield* handlers
            .PostMerge({
              organizationId: fixture.organizationId,
              sourcePostId: mergedSourcePostId,
              targetPostId: activePostId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const posts = yield* handlers
            .PostListPublic({
              organizationId: fixture.organizationId,
              boardId: null,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

          expect(posts.map((post) => post.id)).toEqual([activePostId]);
        })
      );
    });

    describe("PostUpdate", () => {
      it.effect(
        "records one event for a real status transition and none for a no-op",
        () =>
          Effect.gen(function* () {
            recordedIntegrationEvents.length = 0;
            const db = yield* currentDb;
            const handlers = yield* PostRpcHandlersEffect;
            const fixture = yield* makeFixture();
            const postId = yield* PostId.generate;
            const nextStatusId = yield* PostStatusId.generate;
            yield* db.insert(schema.postStatusTable).values({
              id: nextStatusId,
              organizationId: fixture.organizationId,
              orderIndex: 1,
              type: "PLANNED",
            });
            yield* handlers
              .PostCreate(postCreateInput(fixture, postId, "Transition event"))
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );
            recordedIntegrationEvents.length = 0;

            yield* handlers
              .PostUpdate({
                boardId: fixture.boardId,
                id: postId,
                organizationId: fixture.organizationId,
                statusId: fixture.statusId,
              })
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );
            expect(recordedIntegrationEvents).toHaveLength(0);

            yield* handlers
              .PostUpdate({
                boardId: fixture.boardId,
                id: postId,
                organizationId: fixture.organizationId,
                statusId: nextStatusId,
              })
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );
            expect(recordedIntegrationEvents).toEqual([
              expect.objectContaining({
                type: "feedback.post.status_changed",
                data: expect.objectContaining({
                  previousStatus: { id: fixture.statusId, type: "PENDING" },
                }),
              }),
            ]);
          })
      );

      it.effect(
        "coalesces paid status changes into the final five-minute intent",
        () =>
          Effect.gen(function* () {
            const db = yield* currentDb;
            const firstChangeAt = new Date(
              "2026-08-11T00:00:00.000Z"
            ).getTime();
            yield* TestClock.setTime(firstChangeAt);
            const handlers = yield* PostRpcHandlersEffect;
            const fixture = yield* makeFixture();
            yield* activateStarterPlan(fixture.organizationId);
            const postId = yield* PostId.generate;
            const reviewStatusId = yield* PostStatusId.generate;
            const plannedStatusId = yield* PostStatusId.generate;
            yield* db.insert(schema.postStatusTable).values([
              {
                id: reviewStatusId,
                type: "REVIEW",
                orderIndex: 1,
                organizationId: fixture.organizationId,
              },
              {
                id: plannedStatusId,
                type: "PLANNED",
                orderIndex: 2,
                organizationId: fixture.organizationId,
              },
            ]);
            yield* handlers
              .PostCreate(postCreateInput(fixture, postId, "Coalesced status"))
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );

            for (const statusId of [reviewStatusId, plannedStatusId]) {
              yield* handlers
                .PostUpdate({
                  id: postId,
                  organizationId: fixture.organizationId,
                  boardId: fixture.boardId,
                  statusId,
                })
                .pipe(
                  Effect.provideService(CurrentSession, makeSession(fixture))
                );
            }

            const intents = yield* db
              .select()
              .from(schema.emailOutboxTable)
              .where(
                and(
                  eq(schema.emailOutboxTable.aggregateId, postId),
                  eq(schema.emailOutboxTable.kind, "post.status_changed")
                )
              );
            expect(intents).toHaveLength(1);
            expect(intents[0]?.payload).toMatchObject({
              statusId: plannedStatusId,
            });
            expect(intents[0]?.scheduledAt.getTime()).toBeGreaterThanOrEqual(
              firstChangeAt + 299_000
            );
            expect(intents[0]?.scheduledAt.getTime()).toBeLessThanOrEqual(
              firstChangeAt + 300_000
            );
          })
      );

      it.effect(
        "records closure instead of a duplicate status email intent",
        () =>
          Effect.gen(function* () {
            const db = yield* currentDb;
            const handlers = yield* PostRpcHandlersEffect;
            const fixture = yield* makeFixture();
            yield* activateStarterPlan(fixture.organizationId);
            const postId = yield* PostId.generate;
            const closedStatusId = yield* PostStatusId.generate;
            yield* db.insert(schema.postStatusTable).values({
              id: closedStatusId,
              type: "CLOSED",
              orderIndex: 1,
              organizationId: fixture.organizationId,
            });
            yield* handlers
              .PostCreate(postCreateInput(fixture, postId, "Closing"))
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );
            yield* handlers
              .PostUpdate({
                id: postId,
                organizationId: fixture.organizationId,
                boardId: fixture.boardId,
                statusId: closedStatusId,
              })
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );

            const intents = yield* db
              .select({ kind: schema.emailOutboxTable.kind })
              .from(schema.emailOutboxTable)
              .where(
                and(
                  eq(schema.emailOutboxTable.aggregateId, postId),
                  inArray(schema.emailOutboxTable.kind, [
                    "post.status_changed",
                    "post.closed",
                  ])
                )
              );
            expect(intents).toEqual([{ kind: "post.closed" }]);
          })
      );

      it.effect(
        "lets contributors move posts but not change their status",
        () =>
          Effect.gen(function* () {
            const db = yield* currentDb;
            const handlers = yield* PostRpcHandlersEffect;
            const fixture = yield* makeFixture();
            const postId = yield* PostId.generate;
            const destinationBoardId = yield* addBoard(fixture, "PUBLIC");
            const otherStatusId = yield* PostStatusId.generate;

            yield* db.insert(schema.postStatusTable).values({
              id: otherStatusId,
              type: "IN_PROGRESS",
              orderIndex: 1,
              organizationId: fixture.organizationId,
            });
            yield* handlers
              .PostCreate(postCreateInput(fixture, postId, "Movable feedback"))
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );

            yield* handlers
              .PostUpdate({
                id: postId,
                organizationId: fixture.organizationId,
                boardId: destinationBoardId,
                statusId: fixture.statusId,
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, "contributor")
                )
              );

            const error = yield* Effect.flip(
              handlers
                .PostUpdate({
                  id: postId,
                  organizationId: fixture.organizationId,
                  boardId: destinationBoardId,
                  statusId: otherStatusId,
                })
                .pipe(
                  Effect.provideService(
                    CurrentSession,
                    makeSession(fixture, "contributor")
                  )
                )
            );

            expect(error._tag).toBe("PolicyDenied");
          })
      );

      it.effect("lets a post creator change the post", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const postId = yield* PostId.generate;

          yield* handlers
            .PostCreate(
              postCreateInput(
                fixture,
                postId,
                "Original feedback",
                "Original content"
              )
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          yield* handlers
            .PostUpdateContent({
              assetIds: [],
              id: postId,
              organizationId: fixture.organizationId,
              boardId: fixture.boardId,
              content: "Updated content",
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            );
          yield* handlers
            .PostUpdateTitle({
              id: postId,
              organizationId: fixture.organizationId,
              boardId: fixture.boardId,
              title: "Updated feedback",
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            );

          const [post] = yield* handlers
            .PostListPublic({
              organizationId: fixture.organizationId,
              boardId: fixture.boardId,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

          expect(post).toMatchObject({ id: postId, title: "Updated feedback" });
          expect(post?.content).toContain("Updated content");
        })
      );
    });

    describe("PostUpdateEta", () => {
      it.effect("lets a manager set the ETA", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const db = yield* currentDb;
          const fixture = yield* makeFixture();
          const postId = yield* PostId.generate;

          yield* handlers
            .PostCreate(postCreateInput(fixture, postId, "Eta feedback"))
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          yield* handlers
            .PostUpdateEta({
              id: postId,
              organizationId: fixture.organizationId,
              etaQuarter: "2026-Q3",
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            );

          const [row] = yield* db
            .select({ etaQuarter: schema.postTable.etaQuarter })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, postId));

          expect(row?.etaQuarter).toBe("2026-Q3");

          const [activity] = yield* db
            .select({
              kind: schema.postActivityTable.kind,
              previousValue: schema.postActivityTable.previousValue,
              nextValue: schema.postActivityTable.nextValue,
            })
            .from(schema.postActivityTable)
            .where(
              and(
                eq(schema.postActivityTable.postId, postId),
                eq(schema.postActivityTable.kind, "ETA_CHANGED")
              )
            );

          expect(activity).toMatchObject({
            kind: "ETA_CHANGED",
            previousValue: null,
            nextValue: "2026-Q3",
          });
        })
      );

      it.effect("lets a manager clear the ETA", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const db = yield* currentDb;
          const fixture = yield* makeFixture();
          const postId = yield* PostId.generate;

          yield* handlers
            .PostCreate({
              ...postCreateInput(fixture, postId, "Eta feedback"),
              etaQuarter: "2026-Q3",
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          yield* handlers
            .PostUpdateEta({
              id: postId,
              organizationId: fixture.organizationId,
              etaQuarter: null,
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            );

          const [row] = yield* db
            .select({ etaQuarter: schema.postTable.etaQuarter })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, postId));

          expect(row?.etaQuarter).toBeNull();

          const [activity] = yield* db
            .select({
              kind: schema.postActivityTable.kind,
              previousValue: schema.postActivityTable.previousValue,
              nextValue: schema.postActivityTable.nextValue,
            })
            .from(schema.postActivityTable)
            .where(
              and(
                eq(schema.postActivityTable.postId, postId),
                eq(schema.postActivityTable.kind, "ETA_CHANGED")
              )
            );

          expect(activity).toMatchObject({
            kind: "ETA_CHANGED",
            previousValue: "2026-Q3",
            nextValue: null,
          });
        })
      );

      it.effect("denies a contributor", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const postId = yield* PostId.generate;

          yield* handlers
            .PostCreate(postCreateInput(fixture, postId, "Eta feedback"))
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const error = yield* Effect.flip(
            handlers
              .PostUpdateEta({
                id: postId,
                organizationId: fixture.organizationId,
                etaQuarter: "2026-Q3",
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, "contributor")
                )
              )
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );

      it.effect("denies a non-member", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const postId = yield* PostId.generate;

          yield* handlers
            .PostCreate(postCreateInput(fixture, postId, "Eta feedback"))
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const error = yield* Effect.flip(
            handlers
              .PostUpdateEta({
                id: postId,
                organizationId: fixture.organizationId,
                etaQuarter: "2026-Q3",
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

    describe("PostUpdatePublic", () => {
      it.effect("lets non-members update their own unlocked public posts", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const postId = yield* PostId.generate;
          const session = makeSession(fixture, null);

          yield* handlers
            .PostCreatePublic(
              postCreateInput(fixture, postId, "Original feedback")
            )
            .pipe(Effect.provideService(CurrentSession, session));

          const memberOnlyError = yield* Effect.flip(
            handlers
              .PostUpdate({
                id: postId,
                organizationId: fixture.organizationId,
                boardId: fixture.boardId,
                statusId: fixture.statusId,
              })
              .pipe(Effect.provideService(CurrentSession, session))
          );
          expect(memberOnlyError._tag).toBe("PolicyDenied");

          yield* handlers
            .PostUpdatePublic({
              id: postId,
              organizationId: fixture.organizationId,
              boardId: fixture.boardId,
              statusId: fixture.statusId,
            })
            .pipe(Effect.provideService(CurrentSession, session));

          const [post] = yield* handlers
            .PostListPublic({
              organizationId: fixture.organizationId,
              boardId: fixture.boardId,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

          expect(post).toMatchObject({
            id: postId,
            title: "Original feedback",
          });
        })
      );

      it.effect("denies changing the status of their own public post", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const postId = yield* PostId.generate;
          const session = makeSession(fixture, null);
          const completedStatusId = yield* addStatus(fixture, "COMPLETED");

          yield* handlers
            .PostCreatePublic(
              postCreateInput(fixture, postId, "Original feedback")
            )
            .pipe(Effect.provideService(CurrentSession, session));

          // A creator must not be able to mark their own post as completed —
          // status changes are reserved for `posts.status` holders.
          const error = yield* Effect.flip(
            handlers
              .PostUpdatePublic({
                id: postId,
                organizationId: fixture.organizationId,
                boardId: fixture.boardId,
                statusId: completedStatusId,
              })
              .pipe(Effect.provideService(CurrentSession, session))
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );

      it.effect("denies moving their own public post to another board", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const postId = yield* PostId.generate;
          const session = makeSession(fixture, null);
          const otherBoardId = yield* addBoard(fixture, "PUBLIC");

          yield* handlers
            .PostCreatePublic(
              postCreateInput(fixture, postId, "Original feedback")
            )
            .pipe(Effect.provideService(CurrentSession, session));

          const error = yield* Effect.flip(
            handlers
              .PostUpdatePublic({
                id: postId,
                organizationId: fixture.organizationId,
                boardId: otherBoardId,
                statusId: fixture.statusId,
              })
              .pipe(Effect.provideService(CurrentSession, session))
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );
    });

    describe("PostDeletePublic", () => {
      it.effect("lets non-members delete their own public posts", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const postId = yield* PostId.generate;
          const session = makeSession(fixture, null);

          yield* handlers
            .PostCreatePublic(
              postCreateInput(fixture, postId, "Feedback to delete")
            )
            .pipe(Effect.provideService(CurrentSession, session));

          const memberOnlyError = yield* Effect.flip(
            handlers
              .PostDelete({
                id: postId,
                organizationId: fixture.organizationId,
                boardId: fixture.boardId,
              })
              .pipe(Effect.provideService(CurrentSession, session))
          );
          expect(memberOnlyError._tag).toBe("PolicyDenied");

          yield* handlers
            .PostDeletePublic({
              id: postId,
              organizationId: fixture.organizationId,
              boardId: fixture.boardId,
            })
            .pipe(Effect.provideService(CurrentSession, session));

          const posts = yield* handlers
            .PostListPublic({
              organizationId: fixture.organizationId,
              boardId: fixture.boardId,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

          expect(posts).toHaveLength(0);
        })
      );

      it.effect("rejects creator deletion after another user votes", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const postId = yield* PostId.generate;
          const session = makeSession(fixture, null);
          const otherUserId = `other_${fixture.organizationId}`;
          const db = yield* currentDb;

          yield* handlers
            .PostCreatePublic(
              postCreateInput(fixture, postId, "Feedback with another vote")
            )
            .pipe(Effect.provideService(CurrentSession, session));

          yield* db.insert(schema.userTable).values({
            id: otherUserId,
            email: `${otherUserId}@example.com`,
            name: "Other voter",
          });
          yield* db.insert(schema.upvoteTable).values({
            id: yield* UpvoteId.generate,
            postId,
            userId: otherUserId,
            organizationId: fixture.organizationId,
            memberId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          const error = yield* Effect.flip(
            handlers
              .PostDeletePublic({
                id: postId,
                organizationId: fixture.organizationId,
                boardId: fixture.boardId,
              })
              .pipe(Effect.provideService(CurrentSession, session))
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );

      it.effect("rejects creator deletion after a comment", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const postId = yield* PostId.generate;
          const session = makeSession(fixture, null);
          const db = yield* currentDb;

          yield* handlers
            .PostCreatePublic(
              postCreateInput(fixture, postId, "Feedback with a comment")
            )
            .pipe(Effect.provideService(CurrentSession, session));

          yield* db.insert(schema.commentTable).values({
            id: yield* CommentId.generate,
            content: "A comment",
            organizationId: fixture.organizationId,
            postId,
            userId: fixture.userId,
            memberId: null,
            visibility: "PUBLIC",
            parentCommentId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          const error = yield* Effect.flip(
            handlers
              .PostDeletePublic({
                id: postId,
                organizationId: fixture.organizationId,
                boardId: fixture.boardId,
              })
              .pipe(Effect.provideService(CurrentSession, session))
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );
    });

    describe("PostAdminUpdate", () => {
      it.effect("allows managers to moderate posts", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const postId = yield* PostId.generate;

          yield* handlers
            .PostCreate(
              postCreateInput(
                fixture,
                postId,
                "Moderated feedback",
                "Content to moderate"
              )
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          yield* handlers
            .PostAdminUpdate({
              id: postId,
              organizationId: fixture.organizationId,
              locked: true,
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            );

          const [post] = yield* handlers
            .PostListPublic({
              organizationId: fixture.organizationId,
              boardId: fixture.boardId,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

          expect(post?.lockedAt).toBeInstanceOf(Date);
        })
      );
    });

    describe("PostSuggestions", () => {
      it.effect("does not await embedding generation in the handler", () =>
        Effect.gen(function* () {
          let embedCalls = 0;
          const releaseEmbedding = yield* Deferred.make<void>();
          const handlers = yield* PostRpcHandlersEffect.pipe(
            Effect.provideService(PostEmbeddingService, {
              embed: () =>
                Effect.sync(() => {
                  embedCalls += 1;
                }).pipe(
                  Effect.andThen(Deferred.await(releaseEmbedding)),
                  Effect.as(Option.none())
                ),
            })
          );
          const db = yield* currentDb;
          const fixture = yield* makeFixture();
          const postId = yield* PostId.generate;

          yield* handlers
            .PostCreate(postCreateInput(fixture, postId, "Embedded feedback"))
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          yield* Effect.yieldNow;

          const [post] = yield* db
            .select({
              embeddedAt: schema.postTable.embeddedAt,
              embedding: schema.postTable.embedding,
              embeddingModel: schema.postTable.embeddingModel,
            })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, postId));

          expect(embedCalls).toBe(1);
          expect(post?.embedding).toBeNull();
          expect(post?.embeddingModel).toBeNull();
          expect(post?.embeddedAt).toBeNull();
          yield* Deferred.succeed(releaseEmbedding, undefined);
        })
      );

      it.effect("does not store an embedding for an older post revision", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const repository = yield* PostRepository;
          const db = yield* currentDb;
          const fixture = yield* makeFixture();
          const postId = yield* PostId.generate;
          const vector = Array.from(
            { length: DEFAULT_POST_EMBEDDING_DIMENSIONS },
            (_, index) => (index === 0 ? 1 : 0)
          );

          yield* handlers
            .PostCreate(postCreateInput(fixture, postId, "Old title"))
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          yield* repository.update({
            ...postCreateInput(fixture, postId, "Current title"),
          });
          yield* repository.updateEmbedding({
            embedding: vector,
            expectedContent: sanitizeMarkdown("Old title").sanitizedMarkdown,
            expectedTitle: "Old title",
            id: postId,
            model: DEFAULT_POST_EMBEDDING_MODEL,
            organizationId: fixture.organizationId,
          });

          const [post] = yield* db
            .select({ embedding: schema.postTable.embedding })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, postId));

          expect(post?.embedding).toBeNull();
        })
      );

      it.effect("orders stored vectors by cosine distance", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const repository = yield* PostRepository;
          const fixture = yield* makeFixture();
          const nearPostId = yield* PostId.generate;
          const farPostId = yield* PostId.generate;
          const queryVector = Array.from(
            { length: DEFAULT_POST_EMBEDDING_DIMENSIONS },
            (_, index) => (index === 0 ? 1 : 0)
          );
          const farVector = Array.from(
            { length: DEFAULT_POST_EMBEDDING_DIMENSIONS },
            (_, index) => (index < 2 ? 0.5 : 0)
          );

          for (const [id, title] of [
            [nearPostId, "Near vector"],
            [farPostId, "Far vector"],
          ] as const) {
            yield* handlers
              .PostCreate(postCreateInput(fixture, id, title))
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );
          }
          yield* repository.updateEmbedding({
            embedding: queryVector,
            expectedContent: sanitizeMarkdown("Near vector").sanitizedMarkdown,
            expectedTitle: "Near vector",
            id: nearPostId,
            model: DEFAULT_POST_EMBEDDING_MODEL,
            organizationId: fixture.organizationId,
          });
          yield* repository.updateEmbedding({
            embedding: farVector,
            expectedContent: sanitizeMarkdown("Far vector").sanitizedMarkdown,
            expectedTitle: "Far vector",
            id: farPostId,
            model: DEFAULT_POST_EMBEDDING_MODEL,
            organizationId: fixture.organizationId,
          });

          const semanticHandlers = yield* PostRpcHandlersEffect.pipe(
            Effect.provideService(PostEmbeddingService, {
              embed: () =>
                Effect.succeed(
                  Option.some({
                    model: DEFAULT_POST_EMBEDDING_MODEL,
                    vector: queryVector,
                  })
                ),
            })
          );
          const suggestions = yield* semanticHandlers
            .PostSuggestions({
              organizationId: fixture.organizationId,
              boardId: fixture.boardId,
              title: "Semantic query",
              content: "",
              limit: 2,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(suggestions.map((post) => post.id)).toEqual([
            nearPostId,
            farPostId,
          ]);
        })
      );

      it.effect("filters out semantically unrelated posts", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const repository = yield* PostRepository;
          const fixture = yield* makeFixture();
          const nearPostId = yield* PostId.generate;
          const unrelatedPostId = yield* PostId.generate;
          const queryVector = Array.from(
            { length: DEFAULT_POST_EMBEDDING_DIMENSIONS },
            (_, index) => (index === 0 ? 1 : 0)
          );
          const unrelatedVector = Array.from(
            { length: DEFAULT_POST_EMBEDDING_DIMENSIONS },
            (_, index) => (index === 1 ? 1 : 0)
          );

          for (const [id, title] of [
            [nearPostId, "Near vector"],
            [unrelatedPostId, "Unrelated vector"],
          ] as const) {
            yield* handlers
              .PostCreate(postCreateInput(fixture, id, title))
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );
          }
          yield* repository.updateEmbedding({
            embedding: queryVector,
            expectedContent: sanitizeMarkdown("Near vector").sanitizedMarkdown,
            expectedTitle: "Near vector",
            id: nearPostId,
            model: DEFAULT_POST_EMBEDDING_MODEL,
            organizationId: fixture.organizationId,
          });
          yield* repository.updateEmbedding({
            embedding: unrelatedVector,
            expectedContent:
              sanitizeMarkdown("Unrelated vector").sanitizedMarkdown,
            expectedTitle: "Unrelated vector",
            id: unrelatedPostId,
            model: DEFAULT_POST_EMBEDDING_MODEL,
            organizationId: fixture.organizationId,
          });

          const semanticHandlers = yield* PostRpcHandlersEffect.pipe(
            Effect.provideService(PostEmbeddingService, {
              embed: () =>
                Effect.succeed(
                  Option.some({
                    model: DEFAULT_POST_EMBEDDING_MODEL,
                    vector: queryVector,
                  })
                ),
            })
          );
          const suggestions = yield* semanticHandlers
            .PostSuggestions({
              organizationId: fixture.organizationId,
              boardId: fixture.boardId,
              title: "Semantic query",
              content: "",
              limit: 2,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(suggestions.map((post) => post.id)).toEqual([nearPostId]);
        })
      );

      it.effect("ranks similar posts with the lexical fallback", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const billingPostId = yield* PostId.generate;
          const unrelatedPostId = yield* PostId.generate;

          yield* handlers
            .PostCreate(
              postCreateInput(
                fixture,
                billingPostId,
                "Add yearly billing",
                "Please support annual subscription invoices"
              )
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          yield* handlers
            .PostCreate(
              postCreateInput(
                fixture,
                unrelatedPostId,
                "Dark mode",
                "Use a darker color theme"
              )
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const suggestions = yield* handlers
            .PostSuggestions({
              organizationId: fixture.organizationId,
              boardId: fixture.boardId,
              title: "Annual billing",
              content: "Yearly subscription invoices",
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(suggestions.map((post) => post.id)).toEqual([billingPostId]);
        })
      );

      it.effect(
        "only returns public-board posts from the public endpoint",
        () =>
          Effect.gen(function* () {
            const handlers = yield* PostRpcHandlersEffect;
            const fixture = yield* makeFixture("PUBLIC");
            const privateBoardId = yield* addBoard(fixture, "PRIVATE");
            const publicPostId = yield* PostId.generate;
            const privatePostId = yield* PostId.generate;

            yield* handlers
              .PostCreate(
                postCreateInput(
                  fixture,
                  publicPostId,
                  "Export reports",
                  "Export reports to CSV"
                )
              )
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );
            yield* handlers
              .PostCreate({
                ...postCreateInput(
                  fixture,
                  privatePostId,
                  "Private export reports",
                  "Export private reports to CSV"
                ),
                boardId: privateBoardId,
              })
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );

            const suggestions = yield* handlers
              .PostSuggestionsPublic({
                organizationId: fixture.organizationId,
                title: "Export reports",
                content: "CSV reports",
              })
              .pipe(
                Effect.provideService(OptionalCurrentSession, Option.none())
              );

            expect(suggestions.map((post) => post.id)).toEqual([publicPostId]);
          })
      );
    });

    describe("PostMerge", () => {
      it.effect("records the paid merge email intent atomically", () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture();
          yield* activateStarterPlan(fixture.organizationId);
          const sourcePostId = yield* PostId.generate;
          const targetPostId = yield* PostId.generate;
          for (const [id, title] of [
            [sourcePostId, "Source"],
            [targetPostId, "Target"],
          ] as const) {
            yield* handlers
              .PostCreate(postCreateInput(fixture, id, title))
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );
          }
          yield* handlers
            .PostMerge({
              organizationId: fixture.organizationId,
              sourcePostId,
              targetPostId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const intents = yield* db
            .select()
            .from(schema.emailOutboxTable)
            .where(
              and(
                eq(schema.emailOutboxTable.aggregateId, sourcePostId),
                eq(schema.emailOutboxTable.kind, "post.merged")
              )
            );
          expect(intents).toHaveLength(1);
          expect(intents[0]?.payload).toMatchObject({
            postId: sourcePostId,
            targetPostId,
          });
        })
      );

      it.effect("rejects merging a post into itself", () =>
        Effect.scoped(
          Effect.gen(function* () {
            const handlers = yield* PostRpcHandlersEffect;
            const fixture = yield* makeFixture();
            const postId = yield* PostId.generate;
            const error = yield* Effect.flip(
              handlers
                .PostMerge({
                  organizationId: fixture.organizationId,
                  sourcePostId: postId,
                  targetPostId: postId,
                })
                .pipe(
                  Effect.provideService(CurrentSession, makeSession(fixture))
                )
            );

            expect(error).toBeInstanceOf(BadRequestError);
            expect(error.message).toBe(
              "Source and target posts must be different"
            );
          })
        )
      );

      it.effect("archives the source post and records its target", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const sourcePostId = yield* PostId.generate;
          const targetPostId = yield* PostId.generate;

          for (const [id, title] of [
            [sourcePostId, "Source feedback"],
            [targetPostId, "Target feedback"],
          ] as const) {
            yield* handlers
              .PostCreate(postCreateInput(fixture, id, title))
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );
          }

          yield* handlers
            .PostMerge({
              organizationId: fixture.organizationId,
              sourcePostId,
              targetPostId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          // Merge bookkeeping is internal state; the membership-gated list
          // still returns archived/merged rows (the public list filters them).
          const posts = yield* handlers
            .PostList({
              organizationId: fixture.organizationId,
              boardId: fixture.boardId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          const sourcePost = posts.find((post) => post.id === sourcePostId);

          expect(sourcePost).toMatchObject({ mergedIntoPostId: targetPostId });
          expect(sourcePost?.archivedAt).toBeInstanceOf(Date);
          expect(sourcePost?.mergedAt).toBeInstanceOf(Date);
        })
      );
    });
  });
});
