import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  BoardId,
  type LegidOf,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { PostRepository } from "../post/repository";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import { CurrentSession, type Session } from "../session-middleware";
import { UpvoteRpcHandlersEffect } from "./handlers";
import { UpvotePolicy } from "./policies";
import { UpvoteRepository } from "./repository";

describe("UpvoteRpcHandlers", () => {
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

  const createPost = (
    fixture: Fixture,
    id: LegidOf<"PostId">,
    title: string,
    content = title
  ) =>
    Effect.gen(function* () {
      const repository = yield* PostRepository;
      yield* repository.create({
        id,
        boardId: fixture.boardId,
        organizationId: fixture.organizationId,
        statusId: fixture.statusId,
        title,
        content,
        creatorId: fixture.userId,
        creatorMemberId: fixture.membershipId,
      });
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
    PostRepository.layer,
    UpvoteRepository.layer,
    PostSubscriptionRepository.layer
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));

  const HandlerTest = UpvotePolicy.layer.pipe(
    Layer.provideMerge(RepositoriesTest)
  );

  const TestLayer = Layer.merge(HandlerTest, Database.PgliteDatabaseLive);

  layer(TestLayer)("handlers", (it) => {
    describe("UpvoteList", () => {
      it.effect("rejects users without a membership", () =>
        Effect.gen(function* () {
          const handlers = yield* UpvoteRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const error = yield* Effect.flip(
            handlers
              .UpvoteList({
                organizationId: fixture.organizationId,
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

      it.effect("lists upvotes for members", () =>
        Effect.gen(function* () {
          const handlers = yield* UpvoteRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const postId = yield* PostId.generate;

          yield* createPost(fixture, postId, "Test post");

          // Upvote the post
          yield* handlers
            .UpvoteToggle({
              organizationId: fixture.organizationId,
              postId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          // List upvotes
          const upvotes = yield* handlers
            .UpvoteList({
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(upvotes).toHaveLength(1);
          expect(upvotes[0]).toMatchObject({
            postId,
            userId: fixture.userId,
            memberId: fixture.membershipId,
          });
          expect(upvotes[0]?.user.name).toBe("Test User");
        })
      );
    });

    describe("UpvoteToggle", () => {
      it.effect("rejects users without a membership", () =>
        Effect.gen(function* () {
          const handlers = yield* UpvoteRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const postId = yield* PostId.generate;

          yield* createPost(fixture, postId, "Test post");

          const error = yield* Effect.flip(
            handlers
              .UpvoteToggle({
                organizationId: fixture.organizationId,
                postId,
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

      it.effect("rejects upvoting on locked posts", () =>
        Effect.gen(function* () {
          const handlers = yield* UpvoteRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const postId = yield* PostId.generate;

          yield* createPost(fixture, postId, "Test post");

          // Lock the post
          const repository = yield* PostRepository;
          yield* repository.adminUpdate({
            id: postId,
            organizationId: fixture.organizationId,
            locked: true,
          });

          const error = yield* Effect.flip(
            handlers
              .UpvoteToggle({
                organizationId: fixture.organizationId,
                postId,
              })
              .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );

      it.effect("toggles upvote on for a post", () =>
        Effect.gen(function* () {
          const handlers = yield* UpvoteRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const postId = yield* PostId.generate;

          yield* createPost(fixture, postId, "Test post");

          const result = yield* handlers
            .UpvoteToggle({
              organizationId: fixture.organizationId,
              postId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(result.upvoted).toBe(true);

          // Verify the upvote is persisted
          const upvotes = yield* handlers
            .UpvoteList({
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(upvotes).toHaveLength(1);
          expect(upvotes[0]).toMatchObject({ postId, userId: fixture.userId });
        })
      );

      it.effect("toggles upvote off when already upvoted", () =>
        Effect.gen(function* () {
          const handlers = yield* UpvoteRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const postId = yield* PostId.generate;

          yield* createPost(fixture, postId, "Test post");

          // First toggle: upvote
          const first = yield* handlers
            .UpvoteToggle({
              organizationId: fixture.organizationId,
              postId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          expect(first.upvoted).toBe(true);

          // Second toggle: remove upvote
          const second = yield* handlers
            .UpvoteToggle({
              organizationId: fixture.organizationId,
              postId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          expect(second.upvoted).toBe(false);

          // Verify the upvote is removed
          const upvotes = yield* handlers
            .UpvoteList({
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          expect(upvotes).toHaveLength(0);
        })
      );
    });

    describe("UpvoteListPublic", () => {
      it.effect("lists upvotes without authentication", () =>
        Effect.gen(function* () {
          const handlers = yield* UpvoteRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const postId = yield* PostId.generate;

          yield* createPost(fixture, postId, "Test post");

          // Upvote the post as a member
          yield* handlers
            .UpvoteToggle({
              organizationId: fixture.organizationId,
              postId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          // List publicly without auth
          const upvotes = yield* handlers.UpvoteListPublic({
            organizationId: fixture.organizationId,
          });

          expect(upvotes).toHaveLength(1);
          expect(upvotes[0]).toMatchObject({
            postId,
            userId: fixture.userId,
          });
          expect(upvotes[0]?.user.name).toBe("Test User");
        })
      );
    });

    describe("UpvoteTogglePublic", () => {
      it.effect("allows non-members to upvote on public posts", () =>
        Effect.gen(function* () {
          const handlers = yield* UpvoteRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const postId = yield* PostId.generate;

          yield* createPost(fixture, postId, "Test post");

          const result = yield* handlers
            .UpvoteTogglePublic({
              organizationId: fixture.organizationId,
              postId,
            })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture, null))
            );

          expect(result.upvoted).toBe(true);

          // Verify the upvote is visible publicly
          const upvotes = yield* handlers.UpvoteListPublic({
            organizationId: fixture.organizationId,
          });

          expect(upvotes).toHaveLength(1);
          expect(upvotes[0]).toMatchObject({ postId, userId: fixture.userId });
        })
      );

      it.effect("rejects upvoting on locked posts via public endpoint", () =>
        Effect.gen(function* () {
          const handlers = yield* UpvoteRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const postId = yield* PostId.generate;

          yield* createPost(fixture, postId, "Test post");

          // Lock the post
          const repository = yield* PostRepository;
          yield* repository.adminUpdate({
            id: postId,
            organizationId: fixture.organizationId,
            locked: true,
          });

          const error = yield* Effect.flip(
            handlers
              .UpvoteTogglePublic({
                organizationId: fixture.organizationId,
                postId,
              })
              .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );

      it.effect(
        "rejects upvoting on private board posts via public endpoint",
        () =>
          Effect.gen(function* () {
            const handlers = yield* UpvoteRpcHandlersEffect;
            const fixture = yield* makeFixture("PUBLIC");
            const privateBoardId = yield* addBoard(fixture, "PRIVATE");
            const postId = yield* PostId.generate;

            // Create a post on the private board via repository directly
            const repository = yield* PostRepository;
            yield* repository.create({
              id: postId,
              boardId: privateBoardId,
              organizationId: fixture.organizationId,
              statusId: fixture.statusId,
              title: "Private post",
              content: "Content",
              creatorId: fixture.userId,
              creatorMemberId: fixture.membershipId,
            });

            const error = yield* Effect.flip(
              handlers
                .UpvoteTogglePublic({
                  organizationId: fixture.organizationId,
                  postId,
                })
                .pipe(
                  Effect.provideService(CurrentSession, makeSession(fixture))
                )
            );

            expect(error._tag).toBe("PolicyDenied");
          })
      );

      it.effect("toggles upvote off via public endpoint", () =>
        Effect.gen(function* () {
          const handlers = yield* UpvoteRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const postId = yield* PostId.generate;

          yield* createPost(fixture, postId, "Test post");

          const session = makeSession(fixture, null);

          // First toggle: upvote
          const first = yield* handlers
            .UpvoteTogglePublic({
              organizationId: fixture.organizationId,
              postId,
            })
            .pipe(Effect.provideService(CurrentSession, session));
          expect(first.upvoted).toBe(true);

          // Second toggle: remove upvote
          const second = yield* handlers
            .UpvoteTogglePublic({
              organizationId: fixture.organizationId,
              postId,
            })
            .pipe(Effect.provideService(CurrentSession, session));
          expect(second.upvoted).toBe(false);

          // Verify upvote is removed
          const upvotes = yield* handlers.UpvoteListPublic({
            organizationId: fixture.organizationId,
          });
          expect(upvotes).toHaveLength(0);
        })
      );
    });
  });
});
