import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  BoardId,
  CommentId,
  PostId,
  PostStatusId,
  UserBanId,
  UserId,
  WorkspaceId,
  asLegid,
} from "@feeblo/id";
import { and, eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { CommentRepository } from "../comments/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import { PostRepository } from "../post/repository";
import {
  CurrentSession,
  OptionalCurrentSession,
  type Session,
} from "../session-middleware";
import { WorkspaceRepository } from "../workspace/repository";
import { UserBanRpcHandlers, UserBanRpcHandlersEffect } from "./handlers";
import { UserBanRepository } from "./repository";

/** The `Date` for a known instant, built through `DateTime`. */
const dateAt = (instant: number): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(instant));

describe("UserBanRpcHandlers", () => {
  const DatabaseLayer = Database.PgliteDatabaseLive;
  const TestLayer = Layer.mergeAll(
    DatabaseLayer,
    UserBanRpcHandlers.pipe(Layer.provide(DatabaseLayer)),
    UserBanRepository.layer.pipe(Layer.provide(DatabaseLayer)),
    WorkspaceRepository.layer.pipe(Layer.provide(DatabaseLayer)),
    PostRepository.layer.pipe(Layer.provide(DatabaseLayer)),
    CommentRepository.layer.pipe(Layer.provide(DatabaseLayer)),
    EntitlementPolicy.layer.pipe(
      Layer.provide(WorkspaceRepository.layer),
      Layer.provide(DatabaseLayer)
    )
  );

  type Fixture = {
    boardId: string;
    memberId: string;
    organizationId: string;
    role: "admin" | "contributor" | "manager";
    statusId: string;
    userId: string;
  };

  const makeFixture = (
    role: Fixture["role"] = "manager",
    plan: "free" | "starter" = "starter"
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const userId = yield* UserId.generate;
      const memberId = `member_${userId}`;
      const boardId = yield* BoardId.generate;
      const statusId = yield* PostStatusId.generate;
      const now = yield* DateTime.nowAsDate;
      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Ban workspace",
        slug: organizationId,
        createdAt: now,
      });
      yield* db.insert(schema.userTable).values({
        id: userId,
        email: `manager-${userId}@example.com`,
        name: "Manager",
      });
      yield* db.insert(schema.memberTable).values({
        id: memberId,
        createdAt: now,
        organizationId,
        role,
        userId,
      });
      yield* db.insert(schema.boardTable).values({
        id: boardId,
        name: "Ban board",
        slug: boardId,
        visibility: "PUBLIC",
        organizationId,
        creatorId: userId,
        creatorMemberId: memberId,
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.postStatusTable).values({
        id: statusId,
        type: "PENDING",
        orderIndex: 0,
        organizationId,
      });
      if (plan === "starter") {
        const productId = `prod_ban_${organizationId}`;
        yield* db.insert(schema.productTable).values({
          externalOrganizationId: "polar_org",
          id: productId,
          isArchived: false,
          isRecurring: true,
          metadata: { plan: "starter", variant: "monthly" },
          name: "Starter monthly",
          visibility: "PUBLIC",
        });
        yield* db.insert(schema.subscriptionTable).values({
          amount: 4900,
          cancelAtPeriodEnd: false,
          currency: "usd",
          currentPeriodEnd: dateAt(now.getTime() + 86_400_000),
          currentPeriodStart: now,
          customerId: `cus_ban_${organizationId}`,
          externalId: `sub_ext_ban_${organizationId}`,
          id: `sub_ban_${organizationId}`,
          organizationId,
          productId,
          recurringInterval: "month",
          recurringIntervalCount: 1,
          status: "active",
        });
      }
      return {
        boardId,
        memberId,
        organizationId,
        role,
        statusId,
        userId,
      } satisfies Fixture;
    });

  /** An end user tied to the workspace, the way a portal account is. */
  /**
   * An end user tied to the workspace the way a portal account is.
   *
   * `restricted: false` is the account a public board creates for somebody who
   * is not a contact and has no workspace-scoped identity: it can only be
   * banned through a participation row (a post or a comment) that proves the
   * relationship.
   */
  const createEndUser = (input: {
    organizationId: string;
    restricted?: boolean;
    suffix: string;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const id = yield* UserId.generate;
      const email = `${input.suffix}-${id.toLowerCase()}@example.com`;
      yield* db.insert(schema.userTable).values({
        email,
        id,
        name: `End user ${input.suffix}`,
        restrictedToOrganizationId:
          input.restricted === false ? null : input.organizationId,
      });
      return { email, id };
    });

  const createPost = (fixture: Fixture, creatorId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const id = yield* PostId.generate;
      const now = yield* DateTime.nowAsDate;
      yield* db.insert(schema.postTable).values({
        boardId: fixture.boardId,
        content: "Content",
        createdAt: now,
        creatorId,
        id,
        organizationId: fixture.organizationId,
        slug: `slug-${id}`,
        statusId: fixture.statusId,
        title: `Post ${id}`,
        updatedAt: now,
      });
      return id;
    });

  const createComment = (input: {
    authorId: string;
    fixture: Fixture;
    parentCommentId: string | null;
    postId: string;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const id = yield* CommentId.generate;
      const now = yield* DateTime.nowAsDate;
      yield* db.insert(schema.commentTable).values({
        content: "Comment",
        createdAt: now,
        id,
        organizationId: input.fixture.organizationId,
        parentCommentId: input.parentCommentId,
        postId: input.postId,
        updatedAt: now,
        userId: input.authorId,
        visibility: "PUBLIC",
      });
      return id;
    });

  const session = (fixture: Fixture): Session => ({
    user: {
      email: `manager-${fixture.userId}@example.com`,
      id: fixture.userId,
      name: "Manager",
      restrictedToOrganizationId: null,
    },
    session: { token: "test-token", userId: fixture.userId },
    organizations: [{ id: fixture.organizationId }],
    memberships: [
      {
        membershipId: fixture.memberId,
        organizationId: fixture.organizationId,
        role: fixture.role,
      },
    ],
  });

  const asViewer = (
    organizationId: string,
    userId: string,
    email: string
  ): Session => ({
    memberships: [],
    organizations: [{ id: organizationId }],
    session: { token: "viewer-token", userId },
    user: {
      email,
      id: userId,
      name: "Viewer",
      restrictedToOrganizationId: organizationId,
    },
  });

  layer(TestLayer)("handlers", (it) => {
    it.effect("bans, lists and unbans an address", () =>
      Effect.gen(function* () {
        const handlers = yield* UserBanRpcHandlersEffect;
        const fixture = yield* makeFixture();

        const result = yield* handlers
          .BanUser({
            organizationId: fixture.organizationId,
            reason: "Abuse report",
            target: { _tag: "email", email: "Banned@Example.com" },
          })
          .pipe(Effect.provideService(CurrentSession, session(fixture)));

        expect(result).toMatchObject({
          ban: {
            createdByName: "Manager",
            email: "banned@example.com",
            reason: "Abuse report",
          },
          deletedComments: 0,
          deletedPosts: 0,
        });

        const listed = yield* handlers
          .ListUserBans({
            limit: 20,
            offset: 0,
            organizationId: fixture.organizationId,
            search: "banned@",
          })
          .pipe(Effect.provideService(CurrentSession, session(fixture)));
        expect(listed.total).toBe(1);
        expect(listed.items[0]?.email).toBe("banned@example.com");

        const status = yield* handlers
          .GetUserBanStatus({
            organizationId: fixture.organizationId,
          })
          .pipe(
            Effect.provideService(
              OptionalCurrentSession,
              Option.some(
                asViewer(
                  fixture.organizationId,
                  `viewer_${fixture.organizationId}`,
                  "banned@example.com"
                )
              )
            )
          );
        expect(status.banned).toBe(true);

        yield* handlers
          .UnbanUser({
            id: asLegid(UserBanId)(result.ban.id),
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, session(fixture)));

        const after = yield* handlers
          .GetUserBanStatus({
            organizationId: fixture.organizationId,
          })
          .pipe(
            Effect.provideService(
              OptionalCurrentSession,
              Option.some(
                asViewer(
                  fixture.organizationId,
                  `viewer_${fixture.organizationId}`,
                  "banned@example.com"
                )
              )
            )
          );
        expect(after.banned).toBe(false);
      })
    );

    it.effect("requires the manager permission", () =>
      Effect.gen(function* () {
        const handlers = yield* UserBanRpcHandlersEffect;
        const fixture = yield* makeFixture("contributor");

        const error = yield* Effect.flip(
          handlers
            .BanUser({
              organizationId: fixture.organizationId,
              target: { _tag: "email", email: "banned@example.com" },
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)))
        );
        expect(error._tag).toBe("PolicyDenied");
      })
    );

    it.effect("refuses to ban a workspace member", () =>
      Effect.gen(function* () {
        const handlers = yield* UserBanRpcHandlersEffect;
        const fixture = yield* makeFixture();

        const error = yield* Effect.flip(
          handlers
            .BanUser({
              organizationId: fixture.organizationId,
              target: { _tag: "user", userId: fixture.userId },
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)))
        );
        expect(error._tag).toBe("BadRequestError");
        expect(error.message).toContain("membership");
      })
    );

    it.effect("requires the paid plan for the write", () =>
      Effect.gen(function* () {
        const handlers = yield* UserBanRpcHandlersEffect;
        const fixture = yield* makeFixture("manager", "free");

        const error = yield* Effect.flip(
          handlers
            .BanUser({
              organizationId: fixture.organizationId,
              target: { _tag: "email", email: "banned@example.com" },
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)))
        );
        expect(error).toMatchObject({
          _tag: "PolicyDenied",
          reason: "Banning users requires the Starter plan or higher.",
        });

        // The list stays readable on the free plan so a downgraded workspace
        // can still see who it has banned and lift the ban.
        const listed = yield* handlers
          .ListUserBans({
            limit: 20,
            offset: 0,
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, session(fixture)));
        expect(listed.total).toBe(0);
      })
    );

    it.effect("bans a comment's author without naming the account", () =>
      Effect.gen(function* () {
        const handlers = yield* UserBanRpcHandlersEffect;
        const fixture = yield* makeFixture();
        // No contact row and no restricted identity: the comment itself is
        // the proof that this person participated here. This is the shape the
        // seed data has, and the shape a public-board signup has.
        const author = yield* createEndUser({
          organizationId: fixture.organizationId,
          restricted: false,
          suffix: "commenter",
        });
        const postId = yield* createPost(fixture, fixture.userId);
        const commentId = yield* createComment({
          authorId: author.id,
          fixture,
          parentCommentId: null,
          postId,
        });

        const result = yield* handlers
          .BanUser({
            organizationId: fixture.organizationId,
            target: { _tag: "comment", commentId },
          })
          .pipe(Effect.provideService(CurrentSession, session(fixture)));

        expect(result.ban).toMatchObject({
          email: author.email,
          userId: author.id,
        });
      })
    );

    it.effect("bans a post's author through the post", () =>
      Effect.gen(function* () {
        const handlers = yield* UserBanRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const author = yield* createEndUser({
          organizationId: fixture.organizationId,
          restricted: false,
          suffix: "poster",
        });
        const postId = yield* createPost(fixture, author.id);

        const result = yield* handlers
          .BanUser({
            organizationId: fixture.organizationId,
            target: { _tag: "post", postId },
          })
          .pipe(Effect.provideService(CurrentSession, session(fixture)));

        expect(result.ban).toMatchObject({
          email: author.email,
          userId: author.id,
        });
        expect(result.deletedComments).toBe(0);
        expect(result.deletedPosts).toBe(0);
      })
    );

    it.effect("clears the banned person's votes and subscriptions", () =>
      Effect.gen(function* () {
        const handlers = yield* UserBanRpcHandlersEffect;
        const db = yield* currentDb;
        const fixture = yield* makeFixture();
        const banned = yield* createEndUser({
          organizationId: fixture.organizationId,
          restricted: false,
          suffix: "voter",
        });
        const other = yield* createEndUser({
          organizationId: fixture.organizationId,
          restricted: false,
          suffix: "bystander",
        });
        const postId = yield* createPost(fixture, fixture.userId);
        const commentId = yield* createComment({
          authorId: banned.id,
          fixture,
          parentCommentId: null,
          postId,
        });

        const addUpvote = (userId: string) =>
          db.insert(schema.upvoteTable).values({
            id: `upv_${userId}`,
            organizationId: fixture.organizationId,
            postId,
            userId,
          });
        yield* addUpvote(banned.id);
        yield* addUpvote(other.id);

        yield* db.insert(schema.postSubscriptionTable).values({
          id: `psb_${banned.id}`,
          organizationId: fixture.organizationId,
          postId,
          userId: banned.id,
        });
        yield* db.insert(schema.postSubscriptionTable).values({
          id: `psb_${other.id}`,
          organizationId: fixture.organizationId,
          postId,
          userId: other.id,
        });
        yield* db.insert(schema.changelogSubscriptionTable).values({
          id: `cgs_${banned.id}`,
          organizationId: fixture.organizationId,
          userId: banned.id,
        });

        const emailContactId = `ect_${banned.id}`;
        yield* db.insert(schema.emailContactTable).values({
          id: emailContactId,
          email: banned.email,
          organizationId: fixture.organizationId,
          userId: banned.id,
          verificationState: "verified",
        });
        yield* db.insert(schema.emailSubscriptionTable).values({
          id: `esb_${banned.id}`,
          contactId: emailContactId,
          organizationId: fixture.organizationId,
          source: "explicit",
          state: "active",
          topicId: postId,
          topicType: "post",
        });

        yield* handlers
          .BanUser({
            organizationId: fixture.organizationId,
            target: { _tag: "comment", commentId },
          })
          .pipe(Effect.provideService(CurrentSession, session(fixture)));

        const remainingUpvotes = yield* db
          .select({ userId: schema.upvoteTable.userId })
          .from(schema.upvoteTable)
          .where(eq(schema.upvoteTable.organizationId, fixture.organizationId));
        expect(remainingUpvotes.map((row) => row.userId)).toEqual([other.id]);

        const remainingPostSubscriptions = yield* db
          .select({ userId: schema.postSubscriptionTable.userId })
          .from(schema.postSubscriptionTable)
          .where(
            eq(
              schema.postSubscriptionTable.organizationId,
              fixture.organizationId
            )
          );
        expect(remainingPostSubscriptions.map((row) => row.userId)).toEqual([
          other.id,
        ]);

        const remainingChangelogSubscriptions = yield* db
          .select({ userId: schema.changelogSubscriptionTable.userId })
          .from(schema.changelogSubscriptionTable)
          .where(
            eq(
              schema.changelogSubscriptionTable.organizationId,
              fixture.organizationId
            )
          );
        expect(remainingChangelogSubscriptions).toEqual([]);

        const [emailSubscription] = yield* db
          .select({ state: schema.emailSubscriptionTable.state })
          .from(schema.emailSubscriptionTable)
          .where(
            eq(
              schema.emailSubscriptionTable.organizationId,
              fixture.organizationId
            )
          );
        expect(emailSubscription?.state).toBe("unsubscribed");
      })
    );

    it.effect(
      "deletes the banned person's content and keeps other people's replies",
      () =>
        Effect.gen(function* () {
          const handlers = yield* UserBanRpcHandlersEffect;
          const db = yield* currentDb;
          const fixture = yield* makeFixture();
          const banned = yield* createEndUser({
            organizationId: fixture.organizationId,
            suffix: "banned",
          });
          const other = yield* createEndUser({
            organizationId: fixture.organizationId,
            suffix: "other",
          });

          const ownPostId = yield* createPost(fixture, banned.id);
          const otherPostId = yield* createPost(fixture, other.id);
          const bannedCommentId = yield* createComment({
            authorId: banned.id,
            fixture,
            parentCommentId: null,
            postId: otherPostId,
          });
          const replyId = yield* createComment({
            authorId: other.id,
            fixture,
            parentCommentId: bannedCommentId,
            postId: otherPostId,
          });
          const otherCommentId = yield* createComment({
            authorId: other.id,
            fixture,
            parentCommentId: null,
            postId: otherPostId,
          });

          const result = yield* handlers
            .BanUser({
              deleteContent: true,
              organizationId: fixture.organizationId,
              target: { _tag: "comment", commentId: bannedCommentId },
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)));

          expect(result.deletedPosts).toBe(1);
          expect(result.deletedComments).toBe(1);

          const remainingPosts = yield* db
            .select({ id: schema.postTable.id })
            .from(schema.postTable)
            .where(eq(schema.postTable.organizationId, fixture.organizationId));
          expect(remainingPosts.map((row) => row.id)).toEqual([otherPostId]);
          expect(remainingPosts.map((row) => row.id)).not.toContain(ownPostId);

          const remainingComments = yield* db
            .select({
              id: schema.commentTable.id,
              parentCommentId: schema.commentTable.parentCommentId,
            })
            .from(schema.commentTable)
            .where(
              eq(schema.commentTable.organizationId, fixture.organizationId)
            );
          const remainingIds = remainingComments.map((row) => row.id);
          expect(remainingIds).not.toContain(bannedCommentId);
          expect(remainingIds).toEqual(
            expect.arrayContaining([replyId, otherCommentId])
          );
          // The reply is re-anchored instead of cascading away with the
          // comment it answered.
          expect(
            remainingComments.find((row) => row.id === replyId)?.parentCommentId
          ).toBeNull();
        })
    );

    it.effect("keeps content when the ban does not ask for a purge", () =>
      Effect.gen(function* () {
        const handlers = yield* UserBanRpcHandlersEffect;
        const db = yield* currentDb;
        const fixture = yield* makeFixture();
        const banned = yield* createEndUser({
          organizationId: fixture.organizationId,
          suffix: "kept",
        });
        const postId = yield* createPost(fixture, fixture.userId);
        const commentId = yield* createComment({
          authorId: banned.id,
          fixture,
          parentCommentId: null,
          postId,
        });

        const result = yield* handlers
          .BanUser({
            organizationId: fixture.organizationId,
            target: { _tag: "comment", commentId },
          })
          .pipe(Effect.provideService(CurrentSession, session(fixture)));

        expect(result.deletedComments).toBe(0);
        expect(result.deletedPosts).toBe(0);
        const [comment] = yield* db
          .select({ id: schema.commentTable.id })
          .from(schema.commentTable)
          .where(
            and(
              eq(schema.commentTable.id, commentId),
              eq(schema.commentTable.organizationId, fixture.organizationId)
            )
          );
        expect(comment?.id).toBe(commentId);
      })
    );

    it.effect("answers false for an anonymous viewer", () =>
      Effect.gen(function* () {
        const handlers = yield* UserBanRpcHandlersEffect;
        const fixture = yield* makeFixture();

        const status = yield* handlers
          .GetUserBanStatus({
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));
        expect(status.banned).toBe(false);
      })
    );

    /**
     * The ban badge is a server-derived flag, so the one thing worth pinning is
     * which projections carry the answer. The dashboard reads report
     * `true`/`false`; the public ones report `null`, which reads as "not
     * disclosed" and keeps a moderation decision off the board.
     */
    it.effect("derives the author ban flag on dashboard reads only", () =>
      Effect.gen(function* () {
        const handlers = yield* UserBanRpcHandlersEffect;
        const posts = yield* PostRepository;
        const comments = yield* CommentRepository;
        const fixture = yield* makeFixture();
        const author = yield* createEndUser({
          organizationId: fixture.organizationId,
          restricted: false,
          suffix: "flagged",
        });
        const postId = yield* createPost(fixture, author.id);
        const commentId = yield* createComment({
          authorId: author.id,
          fixture,
          parentCommentId: null,
          postId,
        });
        // `createPost` builds the slug from the id; the read below is by slug.
        const slug = `slug-${postId}`;

        const beforeDetail = yield* posts.findBySlug({
          organizationId: fixture.organizationId,
          slug,
        });
        expect(beforeDetail?.authorIsBanned).toBe(false);

        yield* handlers
          .BanUser({
            organizationId: fixture.organizationId,
            target: { _tag: "comment", commentId },
          })
          .pipe(Effect.provideService(CurrentSession, session(fixture)));

        const detail = yield* posts.findBySlug({
          organizationId: fixture.organizationId,
          slug,
        });
        expect(detail?.authorIsBanned).toBe(true);

        const [listRow] = yield* posts.findMany({
          organizationId: fixture.organizationId,
        });
        expect(listRow?.authorIsBanned).toBe(true);

        const [dashboardComment] = yield* comments.findMany({
          organizationId: fixture.organizationId,
          slug,
        });
        expect(dashboardComment?.authorIsBanned).toBe(true);

        const publicPost = yield* posts.findPublicBySlug({
          organizationId: fixture.organizationId,
          slug,
        });
        expect(publicPost?.authorIsBanned).toBeNull();

        const [publicComment] = yield* comments.findManyPublic({
          organizationId: fixture.organizationId,
          slug,
        });
        expect(publicComment?.authorIsBanned).toBeNull();
      })
    );
  });
});
