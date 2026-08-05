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
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import { eq } from "drizzle-orm";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { BoardRepository } from "../board/repository";
import { PostActivityRepository } from "../post-activity/repository";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import { BadRequestError } from "../rpc-errors";
import { S3Test } from "../services/s3-test";
import {
  CurrentSession,
  OptionalCurrentSession,
  type Session,
} from "../session-middleware";
import {
  DEFAULT_POST_EMBEDDING_DIMENSIONS,
  DEFAULT_POST_EMBEDDING_MODEL,
  PostEmbeddingService,
} from "./embedding-service";
import { PostRpcHandlersEffect } from "./handlers";
import { PostPolicy } from "./policies";
import { PostRepository } from "./repository";

describe("PostRpcHandlers", () => {
  type Fixture = {
    boardId: LegidOf<"BoardId">;
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
      email: "user@example.com",
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
        email: `${organizationId}@example.com`,
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

  const RepositoriesTest = Layer.mergeAll(
    BoardRepository.layer,
    PostRepository.layer,
    PostActivityRepository.layer,
    PostSubscriptionRepository.layer
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));

  const HandlerTest = PostPolicy.layer.pipe(
    Layer.provideMerge(RepositoriesTest)
  );

  const TestLayer = Layer.mergeAll(
    HandlerTest,
    Database.PgliteDatabaseLive,
    S3Test
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
              creatorId: fixture.userId,
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
      it.effect("allows contributors to create posts", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const postId = yield* PostId.generate;

          yield* handlers
            .PostCreate(postCreateInput(fixture, postId, "Contributor feedback"))
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

      it.effect("returns a meaningful error on a slug collision", () =>
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

          const error = yield* Effect.flip(
            handlers
              .PostCreate(
                postCreateInput(fixture, secondPostId, "Duplicate title")
              )
              .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
          );

          expect(error._tag).toBe("PostAlreadyExistsError");
          expect(error.message).toBe("A post with this slug already exists");
          expect(error.cause).toBeUndefined();
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
        }),
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
    });

    describe("PostUpdate", () => {
      it.effect("lets contributors move posts but not change their status", () =>
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
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

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

          const posts = yield* handlers
            .PostListPublic({
              organizationId: fixture.organizationId,
              boardId: fixture.boardId,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));
          const sourcePost = posts.find((post) => post.id === sourcePostId);

          expect(sourcePost).toMatchObject({ mergedIntoPostId: targetPostId });
          expect(sourcePost?.archivedAt).toBeInstanceOf(Date);
          expect(sourcePost?.mergedAt).toBeInstanceOf(Date);
        })
      );
    });
  });
});
