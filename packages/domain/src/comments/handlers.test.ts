import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  BoardId,
  CommentId,
  type LegidOf,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { BoardRepository } from "../board/repository";
import { PostPolicy } from "../post/policies";
import { PostRepository } from "../post/repository";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import {
  CurrentSession,
  OptionalCurrentSession,
  type Session,
} from "../session-middleware";
import { CommentRpcHandlersEffect } from "./handlers";
import { CommentPolicy } from "./policies";
import { CommentRepository } from "./repository";

describe("CommentRpcHandlers", () => {
  type Fixture = {
    boardId: LegidOf<"BoardId">;
    membershipId: string;
    organizationId: LegidOf<"WorkspaceId">;
    postId: LegidOf<"PostId">;
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
      const postId = yield* PostId.generate;
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
      yield* db.insert(schema.postTable).values({
        id: postId,
        title: "Test post",
        content: "Test content",
        boardId,
        organizationId,
        statusId,
        creatorId: userId,
        creatorMemberId: membershipId,
        slug: postId,
        excerpt: "Test excerpt",
        createdAt: now,
        updatedAt: now,
      });

      return {
        boardId,
        membershipId,
        organizationId,
        postId,
        statusId,
        userId,
      } satisfies Fixture;
    });

  const commentCreateInput = (
    fixture: Fixture,
    id: LegidOf<"CommentId">,
    content: string,
    visibility: "PUBLIC" | "INTERNAL" = "PUBLIC"
  ) => ({
    id,
    organizationId: fixture.organizationId,
    postId: fixture.postId,
    content,
    visibility,
    parentCommentId: null,
  });

  const addPost = (
    fixture: Fixture,
    boardId: LegidOf<"BoardId">,
    locked = false
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const id = yield* PostId.generate;
      const now = new Date();

      yield* db.insert(schema.postTable).values({
        id,
        title: "Another test post",
        content: "Another test content",
        boardId,
        organizationId: fixture.organizationId,
        statusId: fixture.statusId,
        creatorId: fixture.userId,
        creatorMemberId: fixture.membershipId,
        slug: id,
        excerpt: "Another test excerpt",
        createdAt: now,
        updatedAt: now,
        ...(locked ? { lockedAt: now } : {}),
      });

      return id;
    });

  const RepositoriesTest = Layer.mergeAll(
    BoardRepository.layer,
    CommentRepository.layer,
    PostRepository.layer,
    PostSubscriptionRepository.layer
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));

  const HandlerTest = Layer.mergeAll(
    CommentPolicy.layer,
    PostPolicy.layer
  ).pipe(Layer.provideMerge(RepositoriesTest));

  const TestLayer = Layer.merge(HandlerTest, Database.PgliteDatabaseLive);

  layer(TestLayer)("handlers", (it) => {
    describe("CommentList", () => {
      it.effect("rejects users without a membership", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const error = yield* Effect.flip(
            handlers
              .CommentList({
                organizationId: fixture.organizationId,
                postId: fixture.postId,
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

      it.effect("returns comments for members", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const commentId = yield* CommentId.generate;

          yield* handlers
            .CommentCreate(
              commentCreateInput(fixture, commentId, "A test comment")
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const comments = yield* handlers
            .CommentList({
              organizationId: fixture.organizationId,
              postId: fixture.postId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(comments).toHaveLength(1);
          expect(comments[0]).toMatchObject({
            id: commentId,
            userId: fixture.userId,
          });
          expect(comments[0]?.content).toContain("A test comment");
        })
      );
    });

    describe("CommentListPublic", () => {
      it.effect("does not expose internal comments", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const publicCommentId = yield* CommentId.generate;
          const internalCommentId = yield* CommentId.generate;

          yield* handlers
            .CommentCreate(
              commentCreateInput(fixture, publicCommentId, "Public comment")
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          yield* handlers
            .CommentCreate(
              commentCreateInput(
                fixture,
                internalCommentId,
                "Internal comment",
                "INTERNAL"
              )
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const comments = yield* handlers
            .CommentListPublic({
              organizationId: fixture.organizationId,
              postId: fixture.postId,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

          expect(comments).toHaveLength(1);
          expect(comments[0]).toMatchObject({
            id: publicCommentId,
            visibility: "PUBLIC",
          });
        })
      );

      it.effect("does not expose comments from private boards", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture("PRIVATE");
          const commentId = yield* CommentId.generate;

          yield* handlers
            .CommentCreate(
              commentCreateInput(fixture, commentId, "Private board comment")
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const comments = yield* handlers
            .CommentListPublic({
              organizationId: fixture.organizationId,
              postId: fixture.postId,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

          expect(comments).toHaveLength(0);
        })
      );
    });

    describe("CommentCreate", () => {
      it.effect("rejects non-members", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const commentId = yield* CommentId.generate;
          const error = yield* Effect.flip(
            handlers
              .CommentCreate(
                commentCreateInput(fixture, commentId, "Non-member comment")
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

      it.effect(
        "rejects creating internal comments by non-members via non-public endpoint",
        () =>
          Effect.gen(function* () {
            const handlers = yield* CommentRpcHandlersEffect;
            const fixture = yield* makeFixture("PUBLIC");
            const commentId = yield* CommentId.generate;
            const error = yield* Effect.flip(
              handlers
                .CommentCreate(
                  commentCreateInput(
                    fixture,
                    commentId,
                    "Internal comment attempt",
                    "INTERNAL"
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

      it.effect("allows members to create comments", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const commentId = yield* CommentId.generate;

          const result = yield* handlers
            .CommentCreate(
              commentCreateInput(fixture, commentId, "Member comment")
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(result.message).toBe("Comment created successfully");

          const comments = yield* handlers
            .CommentList({
              organizationId: fixture.organizationId,
              postId: fixture.postId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(comments).toHaveLength(1);
          expect(comments[0]).toMatchObject({
            id: commentId,
            userId: fixture.userId,
            memberId: fixture.membershipId,
          });
          expect(comments[0]?.content).toContain("Member comment");
        })
      );

      it.effect("rejects creating on a locked post", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const lockedPostId = yield* addPost(fixture, fixture.boardId, true);
          const commentId = yield* CommentId.generate;
          const error = yield* Effect.flip(
            handlers
              .CommentCreate({
                id: commentId,
                organizationId: fixture.organizationId,
                postId: lockedPostId,
                content: "Comment on locked post",
                visibility: "PUBLIC" as const,
                parentCommentId: null,
              })
              .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );
    });

    describe("CommentCreatePublic", () => {
      it.effect(
        "allows non-members to create public comments on public boards",
        () =>
          Effect.gen(function* () {
            const handlers = yield* CommentRpcHandlersEffect;
            const fixture = yield* makeFixture("PUBLIC");
            const commentId = yield* CommentId.generate;

            const result = yield* handlers
              .CommentCreatePublic(
                commentCreateInput(fixture, commentId, "Public feedback")
              )
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, null)
                )
              );

            expect(result.message).toBe("Comment created successfully");

            const comments = yield* handlers
              .CommentListPublic({
                organizationId: fixture.organizationId,
                postId: fixture.postId,
              })
              .pipe(
                Effect.provideService(OptionalCurrentSession, Option.none())
              );

            expect(comments).toHaveLength(1);
            expect(comments[0]).toMatchObject({
              id: commentId,
              userId: fixture.userId,
              memberId: null,
            });
            expect(comments[0]?.content).toContain("Public feedback");
          })
      );

      it.effect("rejects creating internal comments by non-members", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const commentId = yield* CommentId.generate;

          // canCreate policy allows PUBLIC by anyone, INTERNAL only by members
          // When opts.allowNonMemberPublic is true (CommentCreatePublic) and !membership:
          //   if visibility !== PUBLIC then it denies
          const error = yield* Effect.flip(
            handlers
              .CommentCreatePublic(
                commentCreateInput(
                  fixture,
                  commentId,
                  "Internal attempt",
                  "INTERNAL"
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

      it.effect("rejects non-members on private boards", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture("PRIVATE");
          const commentId = yield* CommentId.generate;
          const error = yield* Effect.flip(
            handlers
              .CommentCreatePublic(
                commentCreateInput(fixture, commentId, "Private board feedback")
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

      it.effect("rejects creating on a locked post via public endpoint", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const lockedPostId = yield* addPost(fixture, fixture.boardId, true);
          const commentId = yield* CommentId.generate;
          const error = yield* Effect.flip(
            handlers
              .CommentCreatePublic({
                id: commentId,
                organizationId: fixture.organizationId,
                postId: lockedPostId,
                content: "Comment on locked post",
                visibility: "PUBLIC" as const,
                parentCommentId: null,
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

    describe("CommentUpdate", () => {
      it.effect("lets a comment creator update their comment", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const commentId = yield* CommentId.generate;

          yield* handlers
            .CommentCreate(
              commentCreateInput(fixture, commentId, "Original comment")
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const result = yield* handlers
            .CommentUpdate({
              id: commentId,
              organizationId: fixture.organizationId,
              postId: fixture.postId,
              content: "Updated comment",
              visibility: "PUBLIC" as const,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(result.message).toBe("Comment updated successfully");

          const comments = yield* handlers
            .CommentList({
              organizationId: fixture.organizationId,
              postId: fixture.postId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(comments[0]).toMatchObject({
            id: commentId,
          });
          expect(comments[0]?.content).toContain("Updated comment");
        })
      );

      it.effect("rejects non-owner updating a comment", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const commentId = yield* CommentId.generate;

          yield* handlers
            .CommentCreate(commentCreateInput(fixture, commentId, "My comment"))
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          // Create a different user who is a member but not the comment owner
          const otherUserId = `other_user_${fixture.organizationId}`;
          const otherMembershipId = `other_membership_${fixture.organizationId}`;
          const db = yield* currentDb;
          yield* db.insert(schema.userTable).values({
            id: otherUserId,
            email: `other_${fixture.organizationId}@example.com`,
            name: "Other User",
          });
          yield* db.insert(schema.memberTable).values({
            id: otherMembershipId,
            organizationId: fixture.organizationId,
            userId: otherUserId,
            role: "member",
            createdAt: new Date(),
          });

          const otherSession: Session = {
            user: {
              id: otherUserId,
              email: `other_${fixture.organizationId}@example.com`,
              name: "Other User",
              restrictedToOrganizationId: null,
            },
            session: { userId: otherUserId, token: "other-test-token" },
            organizations: [{ id: fixture.organizationId }],
            memberships: [
              {
                membershipId: otherMembershipId,
                organizationId: fixture.organizationId,
                role: "member" as const,
              },
            ],
          };

          const error = yield* Effect.flip(
            handlers
              .CommentUpdate({
                id: commentId,
                organizationId: fixture.organizationId,
                postId: fixture.postId,
                content: "Hijacked comment",
                visibility: "PUBLIC" as const,
              })
              .pipe(Effect.provideService(CurrentSession, otherSession))
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );

      it.effect("rejects non-members updating via non-public endpoint", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const commentId = yield* CommentId.generate;

          yield* handlers
            .CommentCreatePublic(
              commentCreateInput(fixture, commentId, "Public comment")
            )
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture, null))
            );

          const error = yield* Effect.flip(
            handlers
              .CommentUpdate({
                id: commentId,
                organizationId: fixture.organizationId,
                postId: fixture.postId,
                content: "Updated by non-member",
                visibility: "PUBLIC" as const,
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

    describe("CommentUpdatePublic", () => {
      it.effect("allows non-members to update their own public comment", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const commentId = yield* CommentId.generate;

          yield* handlers
            .CommentCreatePublic(
              commentCreateInput(fixture, commentId, "Public comment")
            )
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture, null))
            );

          const result = yield* handlers
            .CommentUpdatePublic({
              id: commentId,
              organizationId: fixture.organizationId,
              postId: fixture.postId,
              content: "Updated public comment",
              visibility: "PUBLIC" as const,
            })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture, null))
            );

          expect(result.message).toBe("Comment updated successfully");

          const comments = yield* handlers
            .CommentListPublic({
              organizationId: fixture.organizationId,
              postId: fixture.postId,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

          expect(comments[0]).toMatchObject({
            id: commentId,
          });
          expect(comments[0]?.content).toContain("Updated public comment");
        })
      );

      it.effect("rejects non-owners updating via public endpoint", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const commentId = yield* CommentId.generate;

          yield* handlers
            .CommentCreatePublic(
              commentCreateInput(fixture, commentId, "Original")
            )
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture, null))
            );

          const otherUserId = `other_user_${fixture.organizationId}`;
          const db = yield* currentDb;
          yield* db.insert(schema.userTable).values({
            id: otherUserId,
            email: `other_${fixture.organizationId}@example.com`,
            name: "Other User",
          });

          const otherSession: Session = {
            user: {
              id: otherUserId,
              email: `other_${fixture.organizationId}@example.com`,
              name: "Other User",
              restrictedToOrganizationId: null,
            },
            session: { userId: otherUserId, token: "other-test-token" },
            organizations: [{ id: fixture.organizationId }],
            memberships: [],
          };

          const error = yield* Effect.flip(
            handlers
              .CommentUpdatePublic({
                id: commentId,
                organizationId: fixture.organizationId,
                postId: fixture.postId,
                content: "Hijacked",
                visibility: "PUBLIC" as const,
              })
              .pipe(Effect.provideService(CurrentSession, otherSession))
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );
    });

    describe("CommentDelete", () => {
      it.effect("lets a comment creator delete their comment", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const commentId = yield* CommentId.generate;

          yield* handlers
            .CommentCreate(
              commentCreateInput(fixture, commentId, "To be deleted")
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const result = yield* handlers
            .CommentDelete({
              id: commentId,
              organizationId: fixture.organizationId,
              postId: fixture.postId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(result.message).toBe("Comment deleted successfully");

          const comments = yield* handlers
            .CommentList({
              organizationId: fixture.organizationId,
              postId: fixture.postId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(comments).toHaveLength(0);
        })
      );

      it.effect("rejects non-owner deleting a comment", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const commentId = yield* CommentId.generate;

          yield* handlers
            .CommentCreate(commentCreateInput(fixture, commentId, "My comment"))
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const otherUserId = `other_user_${fixture.organizationId}`;
          const otherMembershipId = `other_membership_${fixture.organizationId}`;
          const db = yield* currentDb;
          yield* db.insert(schema.userTable).values({
            id: otherUserId,
            email: `other_${fixture.organizationId}@example.com`,
            name: "Other User",
          });
          yield* db.insert(schema.memberTable).values({
            id: otherMembershipId,
            organizationId: fixture.organizationId,
            userId: otherUserId,
            role: "member",
            createdAt: new Date(),
          });

          const otherSession: Session = {
            user: {
              id: otherUserId,
              email: `other_${fixture.organizationId}@example.com`,
              name: "Other User",
              restrictedToOrganizationId: null,
            },
            session: { userId: otherUserId, token: "other-test-token" },
            organizations: [{ id: fixture.organizationId }],
            memberships: [
              {
                membershipId: otherMembershipId,
                organizationId: fixture.organizationId,
                role: "member" as const,
              },
            ],
          };

          const error = yield* Effect.flip(
            handlers
              .CommentDelete({
                id: commentId,
                organizationId: fixture.organizationId,
                postId: fixture.postId,
              })
              .pipe(Effect.provideService(CurrentSession, otherSession))
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );
    });

    describe("CommentDeletePublic", () => {
      it.effect("allows non-members to delete their own public comment", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const commentId = yield* CommentId.generate;

          yield* handlers
            .CommentCreatePublic(
              commentCreateInput(fixture, commentId, "Public comment")
            )
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture, null))
            );

          const result = yield* handlers
            .CommentDeletePublic({
              id: commentId,
              organizationId: fixture.organizationId,
              postId: fixture.postId,
            })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture, null))
            );

          expect(result.message).toBe("Comment deleted successfully");

          const comments = yield* handlers
            .CommentListPublic({
              organizationId: fixture.organizationId,
              postId: fixture.postId,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

          expect(comments).toHaveLength(0);
        })
      );

      it.effect("rejects non-owners deleting via public endpoint", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const commentId = yield* CommentId.generate;

          yield* handlers
            .CommentCreatePublic(
              commentCreateInput(fixture, commentId, "Original")
            )
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture, null))
            );

          const otherUserId = `other_user_${fixture.organizationId}`;
          const db = yield* currentDb;
          yield* db.insert(schema.userTable).values({
            id: otherUserId,
            email: `other_${fixture.organizationId}@example.com`,
            name: "Other User",
          });

          const otherSession: Session = {
            user: {
              id: otherUserId,
              email: `other_${fixture.organizationId}@example.com`,
              name: "Other User",
              restrictedToOrganizationId: null,
            },
            session: { userId: otherUserId, token: "other-test-token" },
            organizations: [{ id: fixture.organizationId }],
            memberships: [],
          };

          const error = yield* Effect.flip(
            handlers
              .CommentDeletePublic({
                id: commentId,
                organizationId: fixture.organizationId,
                postId: fixture.postId,
              })
              .pipe(Effect.provideService(CurrentSession, otherSession))
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );
    });
  });
});
