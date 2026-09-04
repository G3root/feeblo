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

import { EmailOutboxConfig } from "../email-outbox/config";
import { ResolvePrincipalService } from "../identity/service";
import { PostActivityRepository } from "../post-activity/repository";
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

describe("CommentRpcHandlers on-behalf", () => {
  type Role = Session["memberships"][number]["role"];

  type Fixture = {
    boardId: LegidOf<"BoardId">;
    membershipId: string;
    organizationId: LegidOf<"WorkspaceId">;
    postId: LegidOf<"PostId">;
    postSlug: string;
    statusId: LegidOf<"PostStatusId">;
    userEmail: string;
    userId: string;
  };

  const makeFixture = (role: Role = "manager") =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const repository = yield* PostRepository;
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
      const postId = yield* PostId.generate;
      const postSlug = yield* repository.create({
        id: postId,
        boardId,
        organizationId,
        statusId,
        title: "On-behalf comment post",
        content: "On-behalf comment post",
        creatorId: userId,
        creatorMemberId: membershipId,
      });

      return {
        boardId,
        membershipId,
        organizationId,
        postId,
        postSlug,
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

  const getComment = (commentId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const [comment] = yield* db
        .select()
        .from(schema.commentTable)
        .where(eq(schema.commentTable.id, commentId))
        .limit(1);
      return comment;
    });

  const getActivity = (postId: string, commentId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const [activity] = yield* db
        .select()
        .from(schema.postActivityTable)
        .where(
          and(
            eq(schema.postActivityTable.postId, postId),
            eq(schema.postActivityTable.kind, "COMMENT_CREATED"),
            eq(schema.postActivityTable.commentId, commentId)
          )
        )
        .limit(1);
      return activity;
    });

  const RepositoriesTest = Layer.mergeAll(
    PostRepository.layer,
    CommentRepository.layer,
    PostActivityRepository.layer,
    ResolvePrincipalService.layer,
    UserRepository.layer
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));

  const HandlerTest = CommentPolicy.layer.pipe(
    Layer.provideMerge(RepositoriesTest)
  );

  const TestLayer = Layer.mergeAll(
    HandlerTest,
    Database.PgliteDatabaseLive,
    NodeCrypto.layer,
    EmailOutboxConfig.layerTest(new URL("https://feeblo.test")),
    Layer.succeed(
      IntegrationEventRecorder,
      IntegrationEventRecorder.of({
        recordIntegrationEvent: () =>
          Effect.succeed({ deliveryCount: 0, eventRecorded: false as const }),
      })
    )
  );

  layer(TestLayer)("handlers", (it) => {
    describe("CommentCreate with author", () => {
      it.effect(
        "persists the resolved subject as author with null memberId and provenance",
        () =>
          Effect.gen(function* () {
            const handlers = yield* CommentRpcHandlersEffect;
            const db = yield* currentDb;
            const fixture = yield* makeFixture("manager");
            const commentId = yield* CommentId.generate;

            yield* handlers
              .CommentCreate({
                ...commentCreateInput(
                  fixture,
                  commentId,
                  "Recorded from email"
                ),
                author: { email: "jane@example.com", name: "Jane Doe" },
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, "manager")
                )
              );

            // Comments need a user row, so a shadow user was provisioned for
            // the email-only subject and linked to the resolved contact.
            const comment = yield* getComment(commentId);
            expect(comment?.memberId).toBeNull();
            const [shadow] = yield* db
              .select()
              .from(schema.userTable)
              .where(eq(schema.userTable.id, comment!.userId))
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
                  eq(schema.contactTable.email, "jane@example.com")
                )
              )
              .limit(1);
            expect(contact).toMatchObject({
              name: "Jane Doe",
              userId: shadow?.id,
            });

            // The activity keeps the staff member as actor and records the
            // actor/subject relationship as provenance metadata.
            const activity = yield* getActivity(fixture.postId, commentId);
            expect(activity).toMatchObject({
              actorId: fixture.userId,
              actorMemberId: fixture.membershipId,
              metadata: {
                onBehalfOf: {
                  contactId: contact?.id,
                  userId: shadow?.id,
                },
              },
            });
          })
      );

      it.effect("denies contributors", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const db = yield* currentDb;
          const fixture = yield* makeFixture("contributor");
          const commentId = yield* CommentId.generate;

          const error = yield* Effect.flip(
            handlers
              .CommentCreate({
                ...commentCreateInput(
                  fixture,
                  commentId,
                  "Contributor attempt"
                ),
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

          const comments = yield* db
            .select({ id: schema.commentTable.id })
            .from(schema.commentTable)
            .where(eq(schema.commentTable.id, commentId));
          expect(comments).toEqual([]);
        })
      );

      it.effect("allows owners and admins by inheritance", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          for (const role of ["owner", "admin"] as const) {
            const fixture = yield* makeFixture(role);
            const commentId = yield* CommentId.generate;
            yield* handlers
              .CommentCreate({
                ...commentCreateInput(fixture, commentId, `${role} on behalf`),
                author: { email: `${role}@example.com` },
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, role)
                )
              );
            const comment = yield* getComment(commentId);
            expect(comment?.userId).not.toBeNull();
            expect(comment?.memberId).toBeNull();
          }
        })
      );

      it.effect("leaves no-author creation untouched for every role", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          for (const role of [
            "contributor",
            "manager",
            "admin",
            "owner",
          ] as const) {
            const fixture = yield* makeFixture(role);
            const commentId = yield* CommentId.generate;
            yield* handlers
              .CommentCreate(
                commentCreateInput(fixture, commentId, `${role} self comment`)
              )
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, role)
                )
              );

            const comment = yield* getComment(commentId);
            expect(comment).toMatchObject({
              userId: fixture.userId,
              memberId: fixture.membershipId,
            });

            const activity = yield* getActivity(fixture.postId, commentId);
            expect(activity?.metadata).toBeNull();
          }
        })
      );

      it.effect("records no email intents and subscribes nobody", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const db = yield* currentDb;
          const fixture = yield* makeFixture("manager");
          const commentId = yield* CommentId.generate;

          yield* handlers
            .CommentCreate({
              ...commentCreateInput(fixture, commentId, "No email for this"),
              author: { email: "jane@example.com" },
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            );

          // Ordinary comments — including on-behalf ones — never touch the
          // outbox or the in-app watch list.
          const intents = yield* db
            .select({ id: schema.emailOutboxTable.id })
            .from(schema.emailOutboxTable)
            .where(eq(schema.emailOutboxTable.aggregateId, fixture.postId));
          expect(intents).toEqual([]);
          const subscriptions = yield* db
            .select({ id: schema.postSubscriptionTable.id })
            .from(schema.postSubscriptionTable)
            .where(eq(schema.postSubscriptionTable.postId, fixture.postId));
          expect(subscriptions).toEqual([]);
        })
      );

      it.effect("supports INTERNAL visibility on behalf", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const fixture = yield* makeFixture("manager");
          const commentId = yield* CommentId.generate;

          yield* handlers
            .CommentCreate({
              ...commentCreateInput(
                fixture,
                commentId,
                "Internal context from the customer",
                "INTERNAL"
              ),
              author: { email: "jane@example.com" },
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            );

          const comment = yield* getComment(commentId);
          expect(comment).toMatchObject({
            visibility: "INTERNAL",
            memberId: null,
          });
          expect(comment?.userId).not.toBeNull();

          // Internal-comment visibility rules hold: members see it on the
          // dashboard list, the public list hides it.
          const memberComments = yield* handlers
            .CommentList({
              organizationId: fixture.organizationId,
              slug: fixture.postSlug,
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            );
          expect(memberComments.map((row) => row.id)).toEqual([commentId]);

          const publicComments = yield* handlers
            .CommentListPublic({
              organizationId: fixture.organizationId,
              slug: fixture.postSlug,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));
          expect(publicComments).toEqual([]);

          const activity = yield* getActivity(fixture.postId, commentId);
          expect(activity?.metadata).toMatchObject({
            onBehalfOf: { contactId: expect.any(String) },
          });
        })
      );

      it.effect("surfaces SubjectNotFoundError for an unknown contact", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const db = yield* currentDb;
          const fixture = yield* makeFixture("manager");
          const commentId = yield* CommentId.generate;

          const error = yield* Effect.flip(
            handlers
              .CommentCreate({
                ...commentCreateInput(fixture, commentId, "Missing subject"),
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

          const comments = yield* db
            .select({ id: schema.commentTable.id })
            .from(schema.commentTable)
            .where(eq(schema.commentTable.id, commentId));
          expect(comments).toEqual([]);
        })
      );
    });

    describe("CommentCreatePublic", () => {
      it.effect("rejects an author with a bad request", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentRpcHandlersEffect;
          const db = yield* currentDb;
          const fixture = yield* makeFixture();
          const commentId = yield* CommentId.generate;

          const error = yield* Effect.flip(
            handlers
              .CommentCreatePublic({
                ...commentCreateInput(fixture, commentId, "Public on behalf"),
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

          const comments = yield* db
            .select({ id: schema.commentTable.id })
            .from(schema.commentTable)
            .where(eq(schema.commentTable.id, commentId));
          expect(comments).toEqual([]);
        })
      );
    });
  });
});
