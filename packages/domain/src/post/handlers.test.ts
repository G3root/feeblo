import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  BoardId,
  type LegidOf,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { BoardRepository } from "../board/repository";
import { PostActivityRepository } from "../post-activity/repository";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import { BadRequestError } from "../rpc-errors";
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
    role: Session["memberships"][number]["role"] | null = "owner",
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
    content = title,
  ) => ({
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
    PostSubscriptionRepository.layer,
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));

  const HandlerTest = PostPolicy.layer.pipe(
    Layer.provideMerge(RepositoriesTest),
  );

  const TestLayer = Layer.merge(HandlerTest, Database.PgliteDatabaseLive);

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
                  makeSession(fixture, null),
                ),
              ),
          );

          expect(error._tag).toBe("PolicyDenied");
        }),
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
                  "A public idea",
                ),
              )
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, null),
                ),
              );

            const posts = yield* handlers
              .PostListPublic({
                organizationId: fixture.organizationId,
                boardId: fixture.boardId,
              })
              .pipe(
                Effect.provideService(OptionalCurrentSession, Option.none()),
              );

            expect(posts).toHaveLength(1);
            expect(posts[0]).toMatchObject({
              id: postId,
              title: "Public feedback",
              creatorId: fixture.userId,
              creatorMemberId: null,
            });
            expect(posts[0]?.content).toContain("A public idea");
          }),
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
                  "A private idea",
                ),
              )
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, null),
                ),
              ),
          );

          expect(error._tag).toBe("PolicyDenied");
        }),
      );
    });

    describe("PostCreate", () => {
      it.effect("rejects non-members, including on public boards", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const postId = yield* PostId.generate;
          const error = yield* Effect.flip(
            handlers
              .PostCreate(
                postCreateInput(fixture, postId, "Member-only feedback"),
              )
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, null),
                ),
              ),
          );

          expect(error._tag).toBe("PolicyDenied");
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
              postCreateInput(fixture, publicPostId, "Public feedback"),
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
        }),
      );
    });

    describe("PostUpdate", () => {
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
                "Original content",
              ),
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          yield* handlers
            .PostUpdate({
              id: postId,
              organizationId: fixture.organizationId,
              boardId: fixture.boardId,
              statusId: fixture.statusId,
              title: "Updated feedback",
              content: "Updated content",
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "member"),
              ),
            );

          const [post] = yield* handlers
            .PostListPublic({
              organizationId: fixture.organizationId,
              boardId: fixture.boardId,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

          expect(post).toMatchObject({ id: postId, title: "Updated feedback" });
          expect(post?.content).toContain("Updated content");
        }),
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
              postCreateInput(fixture, postId, "Original feedback"),
            )
            .pipe(Effect.provideService(CurrentSession, session));

          const memberOnlyError = yield* Effect.flip(
            handlers
              .PostUpdate({
                id: postId,
                organizationId: fixture.organizationId,
                boardId: fixture.boardId,
                statusId: fixture.statusId,
                title: "Member-only update",
                content: "Member-only content",
              })
              .pipe(Effect.provideService(CurrentSession, session)),
          );
          expect(memberOnlyError._tag).toBe("PolicyDenied");

          yield* handlers
            .PostUpdatePublic({
              id: postId,
              organizationId: fixture.organizationId,
              boardId: fixture.boardId,
              statusId: fixture.statusId,
              title: "Updated feedback",
              content: "Updated content",
            })
            .pipe(Effect.provideService(CurrentSession, session));

          const [post] = yield* handlers
            .PostListPublic({
              organizationId: fixture.organizationId,
              boardId: fixture.boardId,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

          expect(post).toMatchObject({ id: postId, title: "Updated feedback" });
          expect(post?.content).toContain("Updated content");
        }),
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
              postCreateInput(fixture, postId, "Feedback to delete"),
            )
            .pipe(Effect.provideService(CurrentSession, session));

          const memberOnlyError = yield* Effect.flip(
            handlers
              .PostDelete({
                id: postId,
                organizationId: fixture.organizationId,
                boardId: fixture.boardId,
              })
              .pipe(Effect.provideService(CurrentSession, session)),
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
        }),
      );
    });

    describe("PostAdminUpdate", () => {
      it.effect("requires an organization owner or admin", () =>
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
                "Content to moderate",
              ),
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const error = yield* Effect.flip(
            handlers
              .PostAdminUpdate({
                id: postId,
                organizationId: fixture.organizationId,
                locked: true,
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, "member"),
                ),
              ),
          );
          expect(error._tag).toBe("PolicyDenied");

          yield* handlers
            .PostAdminUpdate({
              id: postId,
              organizationId: fixture.organizationId,
              locked: true,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const [post] = yield* handlers
            .PostListPublic({
              organizationId: fixture.organizationId,
              boardId: fixture.boardId,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

          expect(post?.lockedAt).toBeInstanceOf(Date);
        }),
      );
    });

    describe("PostSuggestions", () => {
      it.effect("stores the embedding model and generation timestamp", () =>
        Effect.gen(function* () {
          const handlers = yield* PostRpcHandlersEffect.pipe(
            Effect.provideService(PostEmbeddingService, {
              embed: () =>
                Effect.succeed(
                  Option.some({
                    model: DEFAULT_POST_EMBEDDING_MODEL,
                    vector: Array.from(
                      { length: DEFAULT_POST_EMBEDDING_DIMENSIONS },
                      (_, index) => (index === 0 ? 1 : 0),
                    ),
                  }),
                ),
            }),
          );
          const db = yield* currentDb;
          const fixture = yield* makeFixture();
          const postId = yield* PostId.generate;

          yield* handlers
            .PostCreate(postCreateInput(fixture, postId, "Embedded feedback"))
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const [post] = yield* db
            .select({
              embeddedAt: schema.postTable.embeddedAt,
              embedding: schema.postTable.embedding,
              embeddingModel: schema.postTable.embeddingModel,
            })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, postId));

          expect(post?.embedding).toHaveLength(
            DEFAULT_POST_EMBEDDING_DIMENSIONS,
          );
          expect(post?.embedding?.[0]).toBe(1);
          expect(post?.embeddingModel).toBe(DEFAULT_POST_EMBEDDING_MODEL);
          expect(post?.embeddedAt).toBeInstanceOf(Date);
        }),
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
            (_, index) => (index === 0 ? 1 : 0),
          );
          const farVector = Array.from(
            { length: DEFAULT_POST_EMBEDDING_DIMENSIONS },
            (_, index) => (index === 1 ? 1 : 0),
          );

          for (const [id, title] of [
            [nearPostId, "Near vector"],
            [farPostId, "Far vector"],
          ] as const) {
            yield* handlers
              .PostCreate(postCreateInput(fixture, id, title))
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture)),
              );
          }
          yield* repository.updateEmbedding({
            embedding: queryVector,
            id: nearPostId,
            model: DEFAULT_POST_EMBEDDING_MODEL,
            organizationId: fixture.organizationId,
          });
          yield* repository.updateEmbedding({
            embedding: farVector,
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
                  }),
                ),
            }),
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
        }),
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
                "Please support annual subscription invoices",
              ),
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          yield* handlers
            .PostCreate(
              postCreateInput(
                fixture,
                unrelatedPostId,
                "Dark mode",
                "Use a darker color theme",
              ),
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
        }),
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
                  "Export reports to CSV",
                ),
              )
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture)),
              );
            yield* handlers
              .PostCreate({
                ...postCreateInput(
                  fixture,
                  privatePostId,
                  "Private export reports",
                  "Export private reports to CSV",
                ),
                boardId: privateBoardId,
              })
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture)),
              );

            const suggestions = yield* handlers
              .PostSuggestionsPublic({
                organizationId: fixture.organizationId,
                title: "Export reports",
                content: "CSV reports",
              })
              .pipe(
                Effect.provideService(OptionalCurrentSession, Option.none()),
              );

            expect(suggestions.map((post) => post.id)).toEqual([publicPostId]);
          }),
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
                  Effect.provideService(CurrentSession, makeSession(fixture)),
                ),
            );

            expect(error).toBeInstanceOf(BadRequestError);
            expect(error.message).toBe(
              "Source and target posts must be different",
            );
          }),
        ),
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
                Effect.provideService(CurrentSession, makeSession(fixture)),
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
        }),
      );
    });
  });
});
