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
import * as Option from "effect/Option";
import { BoardRepository } from "../board/repository";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import { BadRequestError } from "../rpc-errors";
import {
  CurrentSession,
  OptionalCurrentSession,
  type Session,
} from "../session-middleware";
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

    describe("PostCreate", () => {
      it.effect(
        "allows non-members to create on public boards and exposes the post publicly",
        () =>
          Effect.gen(function* () {
            const handlers = yield* PostRpcHandlersEffect;
            const fixture = yield* makeFixture("PUBLIC");
            const postId = yield* PostId.generate;

            yield* handlers
              .PostCreate(
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
              .PostCreate(
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
