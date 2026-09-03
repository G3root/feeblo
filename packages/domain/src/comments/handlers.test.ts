import { NodeCrypto } from "@effect/platform-node";
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
import { IntegrationEventRecorder } from "@feeblo/integration-core";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { BoardRepository } from "../board/repository";
import { EmailOutboxConfig } from "../email-outbox/config";
import { ResolvePrincipalService } from "../identity/service";
import { NotificationService } from "../notification/service";
import { PostActivityRepository } from "../post-activity/repository";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import { PostPolicy } from "../post/policies";
import { PostRepository } from "../post/repository";
import {
  CurrentSession,
  OptionalCurrentSession,
  type Session,
} from "../session-middleware";
import { UserRepository } from "../user/repository";
import { CommentRpcHandlersEffect } from "./handlers";
import { CommentPolicy } from "./policies";
import { CommentRepository } from "./repository";

describe("CommentRpcHandlers", () => {
  const recordedIntegrationEvents: Array<unknown> = [];

  type Fixture = {
    boardId: LegidOf<"BoardId">;
    membershipId: string;
    organizationId: LegidOf<"WorkspaceId">;
    postId: LegidOf<"PostId">;
    postSlug: string;
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
      const postSlug = `slug-${postId}`;
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
        slug: postSlug,
        excerpt: "Test excerpt",
        createdAt: now,
        updatedAt: now,
      });

      return {
        boardId,
        membershipId,
        organizationId,
        postId,
        postSlug,
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
        ...(locked && { lockedAt: now }),
      });

      return id;
    });

  const RepositoriesTest = Layer.mergeAll(
    BoardRepository.layer,
    CommentRepository.layer,
    PostActivityRepository.layer,
    PostRepository.layer,
    PostSubscriptionRepository.layer,
    ResolvePrincipalService.layer,
    UserRepository.layer
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));

  const HandlerTest = Layer.mergeAll(
    CommentPolicy.layer,
    PostPolicy.layer
  ).pipe(Layer.provideMerge(RepositoriesTest));

  const TestLayer = Layer.mergeAll(
    HandlerTest,
    Database.PgliteDatabaseLive,
    NodeCrypto.layer,
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
    describe("CommentList", () => {
      it.effect("rejects users without a membership", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const error = yield* Effect.flip(
            handlers
              .CommentList({
                organizationId: fixture.organizationId,
                slug: fixture.postSlug,
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
              slug: fixture.postSlug,
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
              slug: fixture.postSlug,
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
              slug: fixture.postSlug,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

          expect(comments).toHaveLength(0);
        })
      );

      it.effect(
        "re-anchors a public reply beneath its nearest visible ancestor when an intermediary is internal",
        () =>
          Effect.gen(function* () {
            const handlers = yield* CommentRpcHandlersEffect;
            const fixture = yield* makeFixture("PUBLIC");
            const rootId = yield* CommentId.generate;
            const intermediaryId = yield* CommentId.generate;
            const childId = yield* CommentId.generate;

            yield* handlers
              .CommentCreate(
                commentCreateInput(fixture, rootId, "Root comment")
              )
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );
            yield* handlers
              .CommentCreate({
                ...commentCreateInput(fixture, intermediaryId, "Intermediary"),
                parentCommentId: rootId,
              })
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );
            yield* handlers
              .CommentCreate({
                ...commentCreateInput(fixture, childId, "Child reply"),
                parentCommentId: intermediaryId,
              })
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );

            // A member toggles the intermediary internal: public guests then
            // see only root + child, and the child must stay nested beneath
            // its nearest visible ancestor (the root) instead of surfacing
            // as an unrelated top-level thread.
            yield* handlers
              .CommentUpdate({
                id: intermediaryId,
                organizationId: fixture.organizationId,
                postId: fixture.postId,
                content: "Intermediary",
                visibility: "INTERNAL" as const,
              })
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );

            const comments = yield* handlers
              .CommentListPublic({
                organizationId: fixture.organizationId,
                slug: fixture.postSlug,
              })
              .pipe(
                Effect.provideService(OptionalCurrentSession, Option.none())
              );

            expect(comments.map((comment) => comment.id).sort()).toEqual(
              [rootId, childId].sort()
            );
            expect(
              comments.find((comment) => comment.id === rootId)
            ).toMatchObject({
              parentCommentId: null,
              resolvedParentCommentId: null,
            });
            expect(
              comments.find((comment) => comment.id === childId)
            ).toMatchObject({
              parentCommentId: intermediaryId,
              resolvedParentCommentId: rootId,
            });
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
              slug: fixture.postSlug,
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

      it.effect("allows replying to a comment on the same post", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const parentCommentId = yield* CommentId.generate;
          const childCommentId = yield* CommentId.generate;

          yield* handlers
            .CommentCreate(
              commentCreateInput(fixture, parentCommentId, "Parent")
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const result = yield* handlers
            .CommentCreate({
              id: childCommentId,
              organizationId: fixture.organizationId,
              postId: fixture.postId,
              content: "Reply",
              visibility: "PUBLIC" as const,
              parentCommentId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(result.message).toBe("Comment created successfully");
        })
      );

      it.effect("only allows internal replies to an internal comment", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const internalCommentId = yield* CommentId.generate;
          const publicReplyId = yield* CommentId.generate;
          const internalReplyId = yield* CommentId.generate;

          yield* handlers
            .CommentCreate(
              commentCreateInput(
                fixture,
                internalCommentId,
                "Internal parent",
                "INTERNAL"
              )
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          // A PUBLIC reply under an INTERNAL parent would leak member-only
          // context to public visitors, so it is denied.
          const error = yield* Effect.flip(
            handlers
              .CommentCreate({
                id: publicReplyId,
                organizationId: fixture.organizationId,
                postId: fixture.postId,
                content: "Public reply to internal",
                visibility: "PUBLIC" as const,
                parentCommentId: internalCommentId,
              })
              .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
          );
          expect(error._tag).toBe("PolicyDenied");

          // An INTERNAL reply to the same parent is allowed.
          const result = yield* handlers
            .CommentCreate({
              id: internalReplyId,
              organizationId: fixture.organizationId,
              postId: fixture.postId,
              content: "Internal reply to internal",
              visibility: "INTERNAL" as const,
              parentCommentId: internalCommentId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          expect(result.message).toBe("Comment created successfully");
        })
      );

      it.effect("rejects replying to a comment on a different post", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const otherPostId = yield* addPost(fixture, fixture.boardId);
          const parentCommentId = yield* CommentId.generate;
          const childCommentId = yield* CommentId.generate;

          // Parent comment on the first post.
          yield* handlers
            .CommentCreate(
              commentCreateInput(fixture, parentCommentId, "Parent")
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          // Child comment on the second post pointing at the first post's comment.
          const error = yield* Effect.flip(
            handlers
              .CommentCreate({
                id: childCommentId,
                organizationId: fixture.organizationId,
                postId: otherPostId,
                content: "Cross-post reply",
                visibility: "PUBLIC" as const,
                parentCommentId,
              })
              .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );

      it.effect("rejects replying to a nonexistent parent comment", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const missingParentId = yield* CommentId.generate;
          const childCommentId = yield* CommentId.generate;

          // A generated, never-persisted parent id exercises the
          // Option.none branch of canReplyToParent.
          const error = yield* Effect.flip(
            handlers
              .CommentCreate({
                id: childCommentId,
                organizationId: fixture.organizationId,
                postId: fixture.postId,
                content: "Reply to missing parent",
                visibility: "PUBLIC" as const,
                parentCommentId: missingParentId,
              })
              .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );

      it.effect("rejects replying to a comment in another organization", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const orgA = yield* makeFixture();
          const orgB = yield* makeFixture();
          const orgBCommentId = yield* CommentId.generate;
          const orgACommentId = yield* CommentId.generate;

          // A comment in org B.
          yield* handlers
            .CommentCreate(
              commentCreateInput(orgB, orgBCommentId, "Org B comment")
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(orgB)));

          // A comment in org A replying to org B's comment.
          const error = yield* Effect.flip(
            handlers
              .CommentCreate({
                id: orgACommentId,
                organizationId: orgA.organizationId,
                postId: orgA.postId,
                content: "Cross-tenant reply",
                visibility: "PUBLIC" as const,
                parentCommentId: orgBCommentId,
              })
              .pipe(Effect.provideService(CurrentSession, makeSession(orgA)))
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
                slug: fixture.postSlug,
              })
              .pipe(
                Effect.provideService(OptionalCurrentSession, Option.none())
              );

            expect(comments).toHaveLength(1);
            // Commenter identity is redacted on the public list; name stays.
            expect(comments[0]).toMatchObject({
              id: commentId,
              userId: null,
              memberId: null,
              user: { name: "Test User" },
            });
            expect(comments[0]?.content).toContain("Public feedback");
          })
      );

      it.effect("rejects status updates from non-members", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const commentId = yield* CommentId.generate;
          const completedStatusId = yield* PostStatusId.generate;
          const db = yield* currentDb;
          yield* db.insert(schema.postStatusTable).values({
            id: completedStatusId,
            type: "COMPLETED",
            orderIndex: 1,
            organizationId: fixture.organizationId,
          });

          const error = yield* Effect.flip(
            handlers
              .CommentCreatePublic({
                ...commentCreateInput(fixture, commentId, "Shipped it"),
                statusUpdateId: completedStatusId,
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, null)
                )
              )
          );

          expect(error._tag).toBe("PolicyDenied");

          const [post] = yield* db
            .select({ statusId: schema.postTable.statusId })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, fixture.postId));
          // The post status is untouched by the rejected request.
          expect(post?.statusId).toBe(fixture.statusId);
        })
      );

      it.effect("rejects status updates from contributors", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const commentId = yield* CommentId.generate;
          const completedStatusId = yield* PostStatusId.generate;
          const db = yield* currentDb;
          yield* db.insert(schema.postStatusTable).values({
            id: completedStatusId,
            type: "COMPLETED",
            orderIndex: 1,
            organizationId: fixture.organizationId,
          });

          // Contributors can move posts (posts.move) but never change status.
          const error = yield* Effect.flip(
            handlers
              .CommentCreatePublic({
                ...commentCreateInput(fixture, commentId, "Shipped it"),
                statusUpdateId: completedStatusId,
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, "contributor")
                )
              )
          );

          expect(error._tag).toBe("PolicyDenied");

          const [post] = yield* db
            .select({ statusId: schema.postTable.statusId })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, fixture.postId));
          // The post status is untouched by the rejected request.
          expect(post?.statusId).toBe(fixture.statusId);
        })
      );

      it.effect("keeps the session user's identity on the public list", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const commentId = yield* CommentId.generate;

          yield* handlers
            .CommentCreatePublic(
              commentCreateInput(fixture, commentId, "My comment")
            )
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture, null))
            );

          const comments = yield* handlers
            .CommentListPublic({
              organizationId: fixture.organizationId,
              slug: fixture.postSlug,
            })
            .pipe(
              Effect.provideService(
                OptionalCurrentSession,
                Option.some(makeSession(fixture, null))
              )
            );

          expect(comments).toHaveLength(1);
          expect(comments[0]).toMatchObject({
            id: commentId,
            userId: fixture.userId,
            memberId: null,
          });

          // An authenticated caller who is not the commenter sees the
          // commenter's identifiers redacted, same as an anonymous caller.
          const otherUserId = `other_${fixture.organizationId}`;
          const otherSession: Session = {
            user: {
              id: otherUserId,
              email: `${otherUserId}@example.com`,
              name: "Other User",
              restrictedToOrganizationId: null,
            },
            session: { userId: otherUserId, token: "other-token" },
            organizations: [{ id: fixture.organizationId }],
            memberships: [],
          };
          const asOther = yield* handlers
            .CommentListPublic({
              organizationId: fixture.organizationId,
              slug: fixture.postSlug,
            })
            .pipe(
              Effect.provideService(
                OptionalCurrentSession,
                Option.some(otherSession)
              )
            );

          expect(asOther).toHaveLength(1);
          expect(asOther[0]).toMatchObject({
            id: commentId,
            userId: null,
            memberId: null,
          });
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

      it.effect(
        "allows members to create internal comments without exposing them publicly",
        () =>
          Effect.gen(function* () {
            const handlers = yield* CommentRpcHandlersEffect;
            const fixture = yield* makeFixture("PUBLIC");
            const commentId = yield* CommentId.generate;

            const result = yield* handlers
              .CommentCreatePublic(
                commentCreateInput(
                  fixture,
                  commentId,
                  "Member-only context",
                  "INTERNAL"
                )
              )
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );

            expect(result.message).toBe("Comment created successfully");

            const publicComments = yield* handlers
              .CommentListPublic({
                organizationId: fixture.organizationId,
                slug: fixture.postSlug,
              })
              .pipe(
                Effect.provideService(OptionalCurrentSession, Option.none())
              );

            expect(publicComments).toEqual([]);

            const memberComments = yield* handlers
              .CommentList({
                organizationId: fixture.organizationId,
                slug: fixture.postSlug,
              })
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );

            expect(memberComments).toHaveLength(1);
            expect(memberComments[0]).toMatchObject({
              id: commentId,
              visibility: "INTERNAL",
              memberId: fixture.membershipId,
            });
            expect(memberComments[0]?.content).toContain("Member-only context");
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

      it.effect("rejects non-members replying to an internal comment", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const internalCommentId = yield* CommentId.generate;
          const childCommentId = yield* CommentId.generate;

          // A member creates an internal comment.
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

          // A non-member tries to reply to it via the public endpoint.
          const error = yield* Effect.flip(
            handlers
              .CommentCreatePublic({
                id: childCommentId,
                organizationId: fixture.organizationId,
                postId: fixture.postId,
                content: "Reply to internal",
                visibility: "PUBLIC" as const,
                parentCommentId: internalCommentId,
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

    describe("reply notifications", () => {
      // CommentRpcHandlersEffect resolves the notification service via
      // serviceOption at build time, so handlers for these tests must be
      // built with the layer supplied (the suite-level layer omits it).
      const WithNotificationsLayer = NotificationService.layer.pipe(
        Layer.provide(Database.PgliteDatabaseLive)
      );

      it.effect(
        "does not notify a non-member parent author of an internal reply",
        () =>
          Effect.gen(function* () {
            const handlers = yield* CommentRpcHandlersEffect.pipe(
              Effect.provide(WithNotificationsLayer)
            );
            const fixture = yield* makeFixture("PUBLIC");
            const parentCommentId = yield* CommentId.generate;
            const replyId = yield* CommentId.generate;
            const db = yield* currentDb;
            const guestUserId = `guest_${fixture.organizationId}`;
            yield* db.insert(schema.userTable).values({
              id: guestUserId,
              email: `${guestUserId}@example.com`,
              name: "Guest User",
            });
            const guestSession: Session = {
              user: {
                id: guestUserId,
                email: `${guestUserId}@example.com`,
                name: "Guest User",
                restrictedToOrganizationId: null,
              },
              session: { userId: guestUserId, token: "guest-token" },
              organizations: [{ id: fixture.organizationId }],
              memberships: [],
            };

            // A non-member posts a public comment on the public board.
            yield* handlers
              .CommentCreatePublic(
                commentCreateInput(fixture, parentCommentId, "Public question")
              )
              .pipe(Effect.provideService(CurrentSession, guestSession));

            // A member replies internally; the non-member parent author
            // cannot see the reply, so they must not be notified.
            yield* handlers
              .CommentCreate({
                ...commentCreateInput(
                  fixture,
                  replyId,
                  "Internal answer",
                  "INTERNAL"
                ),
                parentCommentId,
              })
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );

            const rows = yield* db
              .select()
              .from(schema.notificationTable)
              .where(
                and(
                  eq(
                    schema.notificationTable.organizationId,
                    fixture.organizationId
                  ),
                  eq(schema.notificationTable.resourceId, replyId)
                )
              );
            expect(rows).toEqual([]);
          })
      );

      it.effect("notifies a member parent author of an internal reply", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect.pipe(
            Effect.provide(WithNotificationsLayer)
          );
          const fixture = yield* makeFixture("PUBLIC");
          const parentCommentId = yield* CommentId.generate;
          const replyId = yield* CommentId.generate;
          const db = yield* currentDb;

          const otherUserId = `other_member_${fixture.organizationId}`;
          const otherMembershipId = `other_membership_${fixture.organizationId}`;
          yield* db.insert(schema.userTable).values({
            id: otherUserId,
            email: `${otherUserId}@example.com`,
            name: "Other Member",
          });
          yield* db.insert(schema.memberTable).values({
            id: otherMembershipId,
            organizationId: fixture.organizationId,
            userId: otherUserId,
            role: "manager",
            createdAt: new Date(),
          });
          const otherMemberSession: Session = {
            user: {
              id: otherUserId,
              email: `${otherUserId}@example.com`,
              name: "Other Member",
              restrictedToOrganizationId: null,
            },
            session: { userId: otherUserId, token: "other-member-token" },
            organizations: [{ id: fixture.organizationId }],
            memberships: [
              {
                membershipId: otherMembershipId,
                organizationId: fixture.organizationId,
                role: "manager",
              },
            ],
          };

          // A member posts a public comment.
          yield* handlers
            .CommentCreate(
              commentCreateInput(fixture, parentCommentId, "Member question")
            )
            .pipe(Effect.provideService(CurrentSession, otherMemberSession));

          // Another member replies internally; the member parent author can
          // see the reply and is still notified.
          yield* handlers
            .CommentCreate({
              ...commentCreateInput(
                fixture,
                replyId,
                "Internal answer",
                "INTERNAL"
              ),
              parentCommentId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const rows = yield* db
            .select()
            .from(schema.notificationTable)
            .where(
              and(
                eq(
                  schema.notificationTable.organizationId,
                  fixture.organizationId
                ),
                eq(schema.notificationTable.resourceId, replyId)
              )
            );
          expect(rows).toHaveLength(1);
          expect(rows[0]?.recipientUserId).toBe(otherUserId);
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
              slug: fixture.postSlug,
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
            role: "manager",
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
                role: "manager" as const,
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
              slug: fixture.postSlug,
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
              slug: fixture.postSlug,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(comments).toHaveLength(0);
        })
      );

      it.effect("allows a manager to delete another user's comment", () =>
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
            role: "manager",
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
                role: "manager" as const,
              },
            ],
          };

          const result = yield* handlers
            .CommentDelete({
              id: commentId,
              organizationId: fixture.organizationId,
              postId: fixture.postId,
            })
            .pipe(Effect.provideService(CurrentSession, otherSession));

          expect(result.message).toBe("Comment deleted successfully");
        })
      );

      it.effect("rejects a contributor deleting another user's comment", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const commentId = yield* CommentId.generate;

          yield* handlers
            .CommentCreate(commentCreateInput(fixture, commentId, "My comment"))
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const otherUserId = `other_contributor_${fixture.organizationId}`;
          const otherMembershipId = `other_contributor_membership_${fixture.organizationId}`;
          const db = yield* currentDb;
          yield* db.insert(schema.userTable).values({
            id: otherUserId,
            email: `${otherUserId}@example.com`,
            name: "Other Contributor",
          });
          yield* db.insert(schema.memberTable).values({
            id: otherMembershipId,
            organizationId: fixture.organizationId,
            userId: otherUserId,
            role: "contributor",
            createdAt: new Date(),
          });

          const otherSession: Session = {
            user: {
              id: otherUserId,
              email: `${otherUserId}@example.com`,
              name: "Other Contributor",
              restrictedToOrganizationId: null,
            },
            session: { userId: otherUserId, token: "other-test-token" },
            organizations: [{ id: fixture.organizationId }],
            memberships: [
              {
                membershipId: otherMembershipId,
                organizationId: fixture.organizationId,
                role: "contributor",
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
              slug: fixture.postSlug,
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

    it.effect("does not subscribe a user when they comment", () =>
      Effect.gen(function* () {
        const handlers = yield* CommentRpcHandlersEffect;
        const subscriptions = yield* PostSubscriptionRepository;
        const fixture = yield* makeFixture();
        const commentId = yield* CommentId.generate;

        const result = yield* handlers
          .CommentCreate(
            commentCreateInput(fixture, commentId, "A comment without opt-in")
          )
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
        expect(result.message).toBe("Comment created successfully");

        const isSubscribed = yield* subscriptions.isSubscribed({
          organizationId: fixture.organizationId,
          postId: fixture.postId,
          userId: fixture.userId,
        });
        expect(isSubscribed).toBe(false);
      })
    );

    describe("status updates", () => {
      const makeStatus = (
        fixture: Fixture,
        type:
          | "PENDING"
          | "REVIEW"
          | "PLANNED"
          | "IN_PROGRESS"
          | "COMPLETED"
          | "CLOSED",
        orderIndex: number
      ) =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const id = yield* PostStatusId.generate;
          yield* db.insert(schema.postStatusTable).values({
            id,
            type,
            orderIndex,
            organizationId: fixture.organizationId,
          });
          return id;
        });

      it.effect(
        "moves the post to the requested status and labels the comment",
        () =>
          Effect.gen(function* () {
            const handlers = yield* CommentRpcHandlersEffect;
            const fixture = yield* makeFixture();
            const commentId = yield* CommentId.generate;
            const completedStatusId = yield* makeStatus(
              fixture,
              "COMPLETED",
              1
            );

            yield* handlers
              .CommentCreate({
                ...commentCreateInput(fixture, commentId, "Shipped it"),
                statusUpdateId: completedStatusId,
              })
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );

            const db = yield* currentDb;
            const [post] = yield* db
              .select({ statusId: schema.postTable.statusId })
              .from(schema.postTable)
              .where(eq(schema.postTable.id, fixture.postId));
            expect(post?.statusId).toBe(completedStatusId);

            const [comment] = yield* db
              .select({
                statusUpdateId: schema.commentTable.statusUpdateId,
              })
              .from(schema.commentTable)
              .where(eq(schema.commentTable.id, commentId));
            expect(comment?.statusUpdateId).toBe(completedStatusId);

            const statusActivity = yield* db
              .select({
                previousValue: schema.postActivityTable.previousValue,
                nextValue: schema.postActivityTable.nextValue,
              })
              .from(schema.postActivityTable)
              .where(
                and(
                  eq(schema.postActivityTable.postId, fixture.postId),
                  eq(schema.postActivityTable.kind, "STATUS_CHANGED")
                )
              );
            expect(statusActivity).toEqual([
              {
                previousValue: fixture.statusId,
                nextValue: completedStatusId,
              },
            ]);
          })
      );

      it.effect(
        "records a post.status_changed integration event for the update",
        () =>
          Effect.gen(function* () {
            const handlers = yield* CommentRpcHandlersEffect;
            const fixture = yield* makeFixture();
            const commentId = yield* CommentId.generate;
            const completedStatusId = yield* makeStatus(
              fixture,
              "COMPLETED",
              1
            );

            yield* handlers
              .CommentCreate({
                ...commentCreateInput(fixture, commentId, "Shipped it"),
                statusUpdateId: completedStatusId,
              })
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );

            const event = recordedIntegrationEvents.find(
              (candidate) =>
                // SAFETY: The recorded envelope exposes `type` for the event.
                (candidate as { type?: string }).type ===
                "feedback.post.status_changed"
            );
            expect(event).toBeDefined();
          })
      );

      it.effect(
        "does not re-label a comment when the post already has the status",
        () =>
          Effect.gen(function* () {
            const handlers = yield* CommentRpcHandlersEffect;
            const fixture = yield* makeFixture();
            const commentId = yield* CommentId.generate;

            // The fixture post already sits in PENDING.
            yield* handlers
              .CommentCreate({
                ...commentCreateInput(fixture, commentId, "Still pending"),
                statusUpdateId: fixture.statusId,
              })
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );

            const db = yield* currentDb;
            const [comment] = yield* db
              .select({
                statusUpdateId: schema.commentTable.statusUpdateId,
              })
              .from(schema.commentTable)
              .where(eq(schema.commentTable.id, commentId));
            expect(comment?.statusUpdateId).toBeNull();
          })
      );

      it.effect("ignores status updates on replies", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const parentCommentId = yield* CommentId.generate;
          const completedStatusId = yield* makeStatus(fixture, "COMPLETED", 1);

          yield* handlers
            .CommentCreate(
              commentCreateInput(fixture, parentCommentId, "Parent")
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          const replyId = yield* CommentId.generate;
          yield* handlers
            .CommentCreate({
              ...commentCreateInput(fixture, replyId, "Reply"),
              parentCommentId,
              statusUpdateId: completedStatusId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const db = yield* currentDb;
          const [post] = yield* db
            .select({ statusId: schema.postTable.statusId })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, fixture.postId));
          expect(post?.statusId).toBe(fixture.statusId);
          const [comment] = yield* db
            .select({ statusUpdateId: schema.commentTable.statusUpdateId })
            .from(schema.commentTable)
            .where(eq(schema.commentTable.id, replyId));
          expect(comment?.statusUpdateId).toBeNull();
        })
      );

      it.effect(
        "applies a status update from a manager via the public endpoint",
        () =>
          Effect.gen(function* () {
            const handlers = yield* CommentRpcHandlersEffect;
            const fixture = yield* makeFixture("PUBLIC");
            const commentId = yield* CommentId.generate;
            const completedStatusId = yield* makeStatus(
              fixture,
              "COMPLETED",
              1
            );

            yield* handlers
              .CommentCreatePublic({
                ...commentCreateInput(fixture, commentId, "Shipped it"),
                statusUpdateId: completedStatusId,
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, "manager")
                )
              );

            const db = yield* currentDb;
            const [post] = yield* db
              .select({ statusId: schema.postTable.statusId })
              .from(schema.postTable)
              .where(eq(schema.postTable.id, fixture.postId));
            expect(post?.statusId).toBe(completedStatusId);

            const [comment] = yield* db
              .select({ statusUpdateId: schema.commentTable.statusUpdateId })
              .from(schema.commentTable)
              .where(eq(schema.commentTable.id, commentId));
            expect(comment?.statusUpdateId).toBe(completedStatusId);
          })
      );

      it.effect("rejects status updates from contributors", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const commentId = yield* CommentId.generate;
          const completedStatusId = yield* makeStatus(fixture, "COMPLETED", 1);

          // Contributors can move posts (posts.move) but never change status,
          // on the dashboard path too.
          const error = yield* Effect.flip(
            handlers
              .CommentCreate({
                ...commentCreateInput(fixture, commentId, "Shipped it"),
                statusUpdateId: completedStatusId,
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, "contributor")
                )
              )
          );

          expect(error._tag).toBe("PolicyDenied");

          const db = yield* currentDb;
          const [post] = yield* db
            .select({ statusId: schema.postTable.statusId })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, fixture.postId));
          // The post status is untouched by the rejected request.
          expect(post?.statusId).toBe(fixture.statusId);
        })
      );
    });
  });
});
