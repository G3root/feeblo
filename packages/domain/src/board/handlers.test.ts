import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { BoardId, type LegidOf, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { BoardPolicy } from "../board/policies";
import { BoardRepository } from "../board/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import { CurrentSession, type Session } from "../session-middleware";
import { WorkspaceRepository } from "../workspace/repository";
import { BoardRpcHandlersEffect } from "./handlers";

describe("BoardRpcHandlers", () => {
  type Fixture = {
    boardId: LegidOf<"BoardId">;
    membershipId: string;
    organizationId: LegidOf<"WorkspaceId">;
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

  const addMemberUser = (
    fixture: Fixture,
    role: "owner" | "admin" | "member" = "member",
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const userId = `user_${fixture.organizationId}_${role}`;
      const membershipId = `membership_${fixture.organizationId}_${role}`;
      const now = new Date();
      yield* db.insert(schema.userTable).values({
        id: userId,
        email: `${userId}@example.com`,
        name: `Test ${role}`,
      });
      yield* db.insert(schema.memberTable).values({
        id: membershipId,
        organizationId: fixture.organizationId,
        userId,
        role,
        createdAt: now,
      });
      return { userId, membershipId };
    });

  const makeFixture = (visibility: "PUBLIC" | "PRIVATE" = "PUBLIC") =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const boardId = yield* BoardId.generate;
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

      return {
        boardId,
        membershipId,
        organizationId,
        userId,
      } satisfies Fixture;
    });

  const boardCreateInput = (
    fixture: Fixture,
    id: LegidOf<"BoardId">,
    name: string,
    visibility: "PUBLIC" | "PRIVATE" = "PUBLIC",
  ) => ({
    id,
    organizationId: fixture.organizationId,
    name,
    visibility,
  });

  const RepositoriesTest = Layer.mergeAll(
    BoardRepository.layer,
    WorkspaceRepository.layer,
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));

  const HandlerTest = BoardPolicy.layer.pipe(
    Layer.provide(EntitlementPolicy.layer),
    Layer.provideMerge(RepositoriesTest),
  );

  const TestLayer = Layer.merge(HandlerTest, Database.PgliteDatabaseLive);

  layer(TestLayer)("handlers", (it) => {
    describe("BoardList", () => {
      it.effect("rejects users without a membership", () =>
        Effect.gen(function* () {
          const handlers = yield* BoardRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const error = yield* Effect.flip(
            handlers
              .BoardList({
                organizationId: fixture.organizationId,
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

      it.effect("returns boards for members", () =>
        Effect.gen(function* () {
          const handlers = yield* BoardRpcHandlersEffect;
          const fixture = yield* makeFixture();

          const boards = yield* handlers
            .BoardList({
              organizationId: fixture.organizationId,
            })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture)),
            );

          expect(boards).toHaveLength(1);
          expect(boards[0]).toMatchObject({
            id: fixture.boardId,
            name: "Test board",
          });
        }),
      );
    });

    describe("BoardListPublic", () => {
      it.effect("does not expose private boards", () =>
        Effect.gen(function* () {
          const handlers = yield* BoardRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const db = yield* currentDb;

          const privateBoardId = yield* BoardId.generate;
          const now = new Date();
          yield* db.insert(schema.boardTable).values({
            id: privateBoardId,
            name: "Private board",
            slug: privateBoardId,
            visibility: "PRIVATE",
            organizationId: fixture.organizationId,
            creatorId: fixture.userId,
            creatorMemberId: fixture.membershipId,
            createdAt: now,
            updatedAt: now,
          });

          const boards = yield* handlers.BoardListPublic({
            organizationId: fixture.organizationId,
          });

          expect(boards.map((b) => b.id)).toEqual([fixture.boardId]);
          expect(boards[0]?.visibility).toBe("PUBLIC");
        }),
      );
    });

    describe("BoardCreate", () => {
      it.effect("rejects non-members", () =>
        Effect.gen(function* () {
          const handlers = yield* BoardRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const boardId = yield* BoardId.generate;
          const error = yield* Effect.flip(
            handlers
              .BoardCreate(
                boardCreateInput(fixture, boardId, "New board"),
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

      it.effect("allows members to create a public board on free plan", () =>
        Effect.gen(function* () {
          const handlers = yield* BoardRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const boardId = yield* BoardId.generate;

          yield* handlers
            .BoardCreate(
              boardCreateInput(fixture, boardId, "My public board", "PUBLIC"),
            )
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture)),
            );

          const boards = yield* handlers.BoardListPublic({
            organizationId: fixture.organizationId,
          });

          expect(boards).toHaveLength(2);
          expect(boards.find((b) => b.id === boardId)).toMatchObject({
            name: "My public board",
            visibility: "PUBLIC",
          });
        }),
      );

      it.effect("rejects private boards on free plan", () =>
        Effect.gen(function* () {
          const handlers = yield* BoardRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const boardId = yield* BoardId.generate;
          const error = yield* Effect.flip(
            handlers
              .BoardCreate(
                boardCreateInput(
                  fixture,
                  boardId,
                  "Private board",
                  "PRIVATE",
                ),
              )
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture)),
              ),
          );

          expect(error._tag).toBe("PolicyDenied");
        }),
      );

      it.effect("respects the board limit on free plan", () =>
        Effect.gen(function* () {
          const handlers = yield* BoardRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");

          // Free plan allows 2 boards. Fixture already creates 1.
          // Create a second board (should succeed).
          const secondBoardId = yield* BoardId.generate;
          yield* handlers
            .BoardCreate(
              boardCreateInput(fixture, secondBoardId, "Second board"),
            )
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture)),
            );

          // Third board should be rejected.
          const thirdBoardId = yield* BoardId.generate;
          const error = yield* Effect.flip(
            handlers
              .BoardCreate(
                boardCreateInput(fixture, thirdBoardId, "Third board"),
              )
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture)),
              ),
          );

          expect(error._tag).toBe("PolicyDenied");
        }),
      );
    });

    describe("BoardUpdate", () => {
      it.effect("rejects non-members", () =>
        Effect.gen(function* () {
          const handlers = yield* BoardRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const error = yield* Effect.flip(
            handlers
              .BoardUpdate({
                id: fixture.boardId,
                organizationId: fixture.organizationId,
                name: "Updated board",
                visibility: "PUBLIC",
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

      it.effect("rejects a non-owner member from updating", () =>
        Effect.gen(function* () {
          const handlers = yield* BoardRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const memberUser = yield* addMemberUser(fixture, "member");
          const memberSession: Session = {
            user: {
              id: memberUser.userId,
              email: `${memberUser.userId}@example.com`,
              name: "Test member",
              restrictedToOrganizationId: null,
            },
            session: { userId: memberUser.userId, token: "test-token" },
            organizations: [{ id: fixture.organizationId }],
            memberships: [
              {
                membershipId: memberUser.membershipId,
                organizationId: fixture.organizationId,
                role: "member",
              },
            ],
          };
          const error = yield* Effect.flip(
            handlers
              .BoardUpdate({
                id: fixture.boardId,
                organizationId: fixture.organizationId,
                name: "Updated board",
                visibility: "PUBLIC",
              })
              .pipe(
                Effect.provideService(CurrentSession, memberSession),
              ),
          );

          expect(error._tag).toBe("PolicyDenied");
        }),
      );

      it.effect("lets the owner update the board", () =>
        Effect.gen(function* () {
          const handlers = yield* BoardRpcHandlersEffect;
          const fixture = yield* makeFixture();

          yield* handlers
            .BoardUpdate({
              id: fixture.boardId,
              organizationId: fixture.organizationId,
              name: "Updated board",
              visibility: "PUBLIC",
            })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture)),
            );

          const boards = yield* handlers.BoardListPublic({
            organizationId: fixture.organizationId,
          });

          expect(boards[0]).toMatchObject({
            id: fixture.boardId,
            name: "Updated board",
          });
        }),
      );
    });

    describe("BoardDelete", () => {
      it.effect("rejects non-members", () =>
        Effect.gen(function* () {
          const handlers = yield* BoardRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const error = yield* Effect.flip(
            handlers
              .BoardDelete({
                id: fixture.boardId,
                organizationId: fixture.organizationId,
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

      it.effect("rejects a non-owner member from deleting", () =>
        Effect.gen(function* () {
          const handlers = yield* BoardRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const memberUser = yield* addMemberUser(fixture, "member");
          const memberSession: Session = {
            user: {
              id: memberUser.userId,
              email: `${memberUser.userId}@example.com`,
              name: "Test member",
              restrictedToOrganizationId: null,
            },
            session: { userId: memberUser.userId, token: "test-token" },
            organizations: [{ id: fixture.organizationId }],
            memberships: [
              {
                membershipId: memberUser.membershipId,
                organizationId: fixture.organizationId,
                role: "member",
              },
            ],
          };
          const error = yield* Effect.flip(
            handlers
              .BoardDelete({
                id: fixture.boardId,
                organizationId: fixture.organizationId,
              })
              .pipe(
                Effect.provideService(CurrentSession, memberSession),
              ),
          );

          expect(error._tag).toBe("PolicyDenied");
        }),
      );

      it.effect("lets the owner delete the board", () =>
        Effect.gen(function* () {
          const handlers = yield* BoardRpcHandlersEffect;
          const fixture = yield* makeFixture();

          yield* handlers
            .BoardDelete({
              id: fixture.boardId,
              organizationId: fixture.organizationId,
            })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture)),
            );

          const boards = yield* handlers.BoardListPublic({
            organizationId: fixture.organizationId,
          });

          expect(boards).toHaveLength(0);
        }),
      );
    });
  });
});
