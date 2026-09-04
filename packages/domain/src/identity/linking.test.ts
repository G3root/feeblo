import { createHash } from "node:crypto";

import { NodeCrypto } from "@effect/platform-node";
import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { BoardId, PostStatusId, WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { linkAnonymousAccount } from "../widget/sso";
import { SubjectNotFoundError } from "./errors";
import { healShadowsForVerifiedUser, linkShadowUser } from "./linking";

const hashEmail = (email: string): string =>
  createHash("sha256").update(email.toLowerCase().trim()).digest("hex");

const randomHex = (length: number): string =>
  Array.from({ length }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join("");

/**
 * Every test in this file shares one PGlite database, so fixtures derive
 * their row ids and emails from a per-test counter instead of literals.
 */
let testRun = 0;
const nextTestRun = (): number => {
  testRun += 1;
  return testRun;
};

describe("identity linking", () => {
  const TestLayer = Layer.mergeAll(
    Database.PgliteDatabaseLive,
    NodeCrypto.layer
  );

  const makeOrganization = () =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Test organization",
        slug: organizationId,
        createdAt: new Date(),
      });
      return organizationId;
    });

  const insertRealUser = (args: {
    id: string;
    email: string;
    emailVerified?: boolean;
    restrictedToOrganizationId?: string;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.userTable).values({
        id: args.id,
        name: args.id,
        email: args.email,
        emailHash: hashEmail(args.email),
        emailVerified: args.emailVerified ?? true,
        ...(args.restrictedToOrganizationId && {
          restrictedToOrganizationId: args.restrictedToOrganizationId,
        }),
      });
    });

  /** Mirrors `provisionShadowUser`: synthetic inbox, unverified, org-bound. */
  const insertShadowUser = (args: {
    id: string;
    email: string;
    organizationId: string;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.userTable).values({
        id: args.id,
        name: "Shadow",
        email: `behalf-${randomHex(16)}@feeblo.com`,
        emailHash: hashEmail(args.email),
        emailVerified: false,
        restrictedToOrganizationId: args.organizationId,
      });
    });

  const insertSsoPortalUser = (args: {
    id: string;
    email: string;
    organizationId: string;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.userTable).values({
        id: args.id,
        name: "Portal User",
        email: `sso-${randomHex(16)}@feeblo.com`,
        emailHash: hashEmail(args.email),
        emailVerified: true,
        restrictedToOrganizationId: args.organizationId,
      });
    });

  const insertMembership = (args: {
    id: string;
    organizationId: string;
    userId: string;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.memberTable).values({
        id: args.id,
        organizationId: args.organizationId,
        userId: args.userId,
        role: "manager",
        createdAt: new Date(),
      });
    });

  const makeBoardAndStatus = (organizationId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const boardId = yield* BoardId.generate;
      const statusId = yield* PostStatusId.generate;
      const now = new Date();
      yield* db.insert(schema.boardTable).values({
        id: boardId,
        name: "Board",
        slug: boardId,
        visibility: "PUBLIC",
        organizationId,
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.postStatusTable).values({
        id: statusId,
        type: "PENDING",
        orderIndex: 0,
        organizationId,
      });
      return { boardId, statusId };
    });

  const insertPost = (args: {
    id: string;
    organizationId: string;
    boardId: string;
    statusId: string;
    creatorId: string | null;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const now = new Date();
      yield* db.insert(schema.postTable).values({
        id: args.id,
        title: `Post ${args.id}`,
        slug: args.id,
        content: "Content",
        boardId: args.boardId,
        statusId: args.statusId,
        organizationId: args.organizationId,
        creatorId: args.creatorId,
        createdAt: now,
        updatedAt: now,
      });
    });

  const insertContact = (args: {
    id: string;
    organizationId: string;
    email: string;
    userId: string | null;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const now = new Date();
      yield* db.insert(schema.contactTable).values({
        id: args.id,
        organizationId: args.organizationId,
        email: args.email,
        name: "Jane Doe",
        userId: args.userId,
        createdAt: now,
        updatedAt: now,
      });
    });

  const insertUpvote = (args: {
    id: string;
    organizationId: string;
    postId: string;
    userId: string;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.upvoteTable).values({
        id: args.id,
        organizationId: args.organizationId,
        postId: args.postId,
        userId: args.userId,
      });
    });

  const insertComment = (args: {
    id: string;
    organizationId: string;
    postId: string;
    userId: string;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.commentTable).values({
        id: args.id,
        content: "Comment",
        organizationId: args.organizationId,
        postId: args.postId,
        userId: args.userId,
      });
    });

  const insertPostSubscription = (args: {
    id: string;
    organizationId: string;
    postId: string;
    userId: string;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.postSubscriptionTable).values({
        id: args.id,
        organizationId: args.organizationId,
        postId: args.postId,
        userId: args.userId,
      });
    });

  const insertDeferredEmailSubscription = (args: {
    id: string;
    organizationId: string;
    email: string;
    postId: string;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const now = new Date();
      const emailContactId = `email_contact_${args.id}`;
      yield* db.insert(schema.emailContactTable).values({
        id: emailContactId,
        organizationId: args.organizationId,
        email: args.email,
        verificationState: "pending",
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.emailSubscriptionTable).values({
        id: `email_sub_${args.id}`,
        organizationId: args.organizationId,
        contactId: emailContactId,
        topicType: "post",
        topicId: args.postId,
        source: "admin_added_voter",
        state: "deferred_no_access",
        createdAt: now,
        updatedAt: now,
      });
    });

  const getUserById = (id: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const [row] = yield* db
        .select()
        .from(schema.userTable)
        .where(eq(schema.userTable.id, id))
        .limit(1);
      return row;
    });

  const getContactById = (id: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const [row] = yield* db
        .select()
        .from(schema.contactTable)
        .where(eq(schema.contactTable.id, id))
        .limit(1);
      return row;
    });

  const getPostById = (id: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const [row] = yield* db
        .select()
        .from(schema.postTable)
        .where(eq(schema.postTable.id, id))
        .limit(1);
      return row;
    });

  const listUpvotesForPost = (postId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      return yield* db
        .select({ userId: schema.upvoteTable.userId })
        .from(schema.upvoteTable)
        .where(eq(schema.upvoteTable.postId, postId));
    });

  const listPostSubscriptionsForPost = (postId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      return yield* db
        .select({ userId: schema.postSubscriptionTable.userId })
        .from(schema.postSubscriptionTable)
        .where(eq(schema.postSubscriptionTable.postId, postId));
    });

  const getEmailSubscriptionById = (id: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const [row] = yield* db
        .select()
        .from(schema.emailSubscriptionTable)
        .where(eq(schema.emailSubscriptionTable.id, `email_sub_${id}`))
        .limit(1);
      return row;
    });

  const getEmailContactById = (id: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const [row] = yield* db
        .select()
        .from(schema.emailContactTable)
        .where(eq(schema.emailContactTable.id, `email_contact_${id}`))
        .limit(1);
      return row;
    });

  layer(TestLayer)("linkShadowUser", (it) => {
    it.effect("heals every attributed row off the shadow and deletes it", () =>
      Effect.gen(function* () {
        const n = nextTestRun();
        const db = yield* currentDb;
        const organizationId = yield* makeOrganization();
        const real = `real_${n}`;
        const shadow = `shadow_${n}`;
        const email = `jane.${n}@example.com`;
        yield* insertRealUser({ id: real, email });
        yield* insertMembership({
          id: `membership_${n}`,
          organizationId,
          userId: real,
        });
        yield* insertShadowUser({ id: shadow, email, organizationId });
        const { boardId, statusId } = yield* makeBoardAndStatus(organizationId);
        yield* insertPost({
          id: `post_${n}`,
          organizationId,
          boardId,
          statusId,
          creatorId: shadow,
        });
        yield* insertContact({
          id: `contact_${n}`,
          organizationId,
          email,
          userId: shadow,
        });
        yield* insertUpvote({
          id: `upvote_${n}`,
          organizationId,
          postId: `post_${n}`,
          userId: shadow,
        });
        yield* insertComment({
          id: `comment_${n}`,
          organizationId,
          postId: `post_${n}`,
          userId: shadow,
        });
        yield* insertPostSubscription({
          id: `post_sub_${n}`,
          organizationId,
          postId: `post_${n}`,
          userId: shadow,
        });
        yield* insertDeferredEmailSubscription({
          id: `sub_${n}`,
          organizationId,
          email,
          postId: `post_${n}`,
        });

        const counts = yield* linkShadowUser({
          shadowUserId: shadow,
          realUserId: real,
          deleteShadowUser: true,
        });

        // Assert every touched table afterwards: the transaction leaves no
        // partially healed state behind.
        expect(counts).toEqual({
          contacts: 1,
          posts: 1,
          upvotesMoved: 1,
          upvotesDropped: 0,
          comments: 1,
          postSubscriptionsMoved: 1,
          postSubscriptionsDropped: 0,
          subscriptionsActivated: 1,
        });
        expect((yield* getContactById(`contact_${n}`))?.userId).toBe(real);
        expect((yield* getPostById(`post_${n}`))?.creatorId).toBe(real);
        expect(yield* listUpvotesForPost(`post_${n}`)).toEqual([
          { userId: real },
        ]);
        const [comment] = yield* db
          .select()
          .from(schema.commentTable)
          .where(eq(schema.commentTable.id, `comment_${n}`));
        expect(comment?.userId).toBe(real);
        expect(yield* listPostSubscriptionsForPost(`post_${n}`)).toEqual([
          { userId: real },
        ]);
        const subscription = yield* getEmailSubscriptionById(`sub_${n}`);
        expect(subscription?.state).toBe("active");
        expect(subscription?.verifiedAt).not.toBeNull();
        const emailContact = yield* getEmailContactById(`sub_${n}`);
        expect(emailContact?.userId).toBe(real);
        expect(emailContact?.verificationState).toBe("verified");
        expect(yield* getUserById(shadow)).toBeUndefined();
        expect(yield* getUserById(real)).toBeDefined();
      })
    );

    it.effect("drops the shadow's vote when the real user already voted", () =>
      Effect.gen(function* () {
        const n = nextTestRun();
        const organizationId = yield* makeOrganization();
        const real = `real_${n}`;
        const shadow = `shadow_${n}`;
        yield* insertRealUser({
          id: real,
          email: `jane.${n}@example.com`,
        });
        yield* insertShadowUser({
          id: shadow,
          email: `jane.${n}@example.com`,
          organizationId,
        });
        const { boardId, statusId } = yield* makeBoardAndStatus(organizationId);
        yield* insertPost({
          id: `post_${n}a`,
          organizationId,
          boardId,
          statusId,
          creatorId: null,
        });
        yield* insertPost({
          id: `post_${n}b`,
          organizationId,
          boardId,
          statusId,
          creatorId: null,
        });
        yield* insertUpvote({
          id: `upvote_${n}_real_a`,
          organizationId,
          postId: `post_${n}a`,
          userId: real,
        });
        yield* insertUpvote({
          id: `upvote_${n}_shadow_a`,
          organizationId,
          postId: `post_${n}a`,
          userId: shadow,
        });
        yield* insertUpvote({
          id: `upvote_${n}_shadow_b`,
          organizationId,
          postId: `post_${n}b`,
          userId: shadow,
        });

        const counts = yield* linkShadowUser({
          shadowUserId: shadow,
          realUserId: real,
          deleteShadowUser: true,
        });

        // The colliding vote is dropped, not merged; the rest moves.
        expect(counts.upvotesDropped).toBe(1);
        expect(counts.upvotesMoved).toBe(1);
        expect(yield* listUpvotesForPost(`post_${n}a`)).toEqual([
          { userId: real },
        ]);
        expect(yield* listUpvotesForPost(`post_${n}b`)).toEqual([
          { userId: real },
        ]);
      })
    );

    it.effect("drops duplicate post subscriptions instead of colliding", () =>
      Effect.gen(function* () {
        const n = nextTestRun();
        const organizationId = yield* makeOrganization();
        const real = `real_${n}`;
        const shadow = `shadow_${n}`;
        yield* insertRealUser({
          id: real,
          email: `jane.${n}@example.com`,
        });
        yield* insertShadowUser({
          id: shadow,
          email: `jane.${n}@example.com`,
          organizationId,
        });
        const { boardId, statusId } = yield* makeBoardAndStatus(organizationId);
        yield* insertPost({
          id: `post_${n}a`,
          organizationId,
          boardId,
          statusId,
          creatorId: null,
        });
        yield* insertPost({
          id: `post_${n}b`,
          organizationId,
          boardId,
          statusId,
          creatorId: null,
        });
        yield* insertPostSubscription({
          id: `post_sub_${n}_real_a`,
          organizationId,
          postId: `post_${n}a`,
          userId: real,
        });
        yield* insertPostSubscription({
          id: `post_sub_${n}_shadow_a`,
          organizationId,
          postId: `post_${n}a`,
          userId: shadow,
        });
        yield* insertPostSubscription({
          id: `post_sub_${n}_shadow_b`,
          organizationId,
          postId: `post_${n}b`,
          userId: shadow,
        });

        const counts = yield* linkShadowUser({
          shadowUserId: shadow,
          realUserId: real,
          deleteShadowUser: true,
        });

        expect(counts.postSubscriptionsDropped).toBe(1);
        expect(counts.postSubscriptionsMoved).toBe(1);
        expect(yield* listPostSubscriptionsForPost(`post_${n}a`)).toEqual([
          { userId: real },
        ]);
        expect(yield* listPostSubscriptionsForPost(`post_${n}b`)).toEqual([
          { userId: real },
        ]);
      })
    );

    it.effect(
      "activates deferred subscriptions for an SSO-bound surviving account",
      () =>
        Effect.gen(function* () {
          const n = nextTestRun();
          const organizationId = yield* makeOrganization();
          const real = `portal_${n}`;
          const shadow = `shadow_${n}`;
          // Verified and bound to the workspace through SSO, but no membership.
          yield* insertRealUser({
            id: real,
            email: `jane.${n}@example.com`,
            restrictedToOrganizationId: organizationId,
          });
          yield* insertShadowUser({
            id: shadow,
            email: `jane.${n}@example.com`,
            organizationId,
          });
          yield* insertContact({
            id: `contact_${n}`,
            organizationId,
            email: `jane.${n}@example.com`,
            userId: shadow,
          });
          const { boardId, statusId } =
            yield* makeBoardAndStatus(organizationId);
          yield* insertPost({
            id: `post_${n}`,
            organizationId,
            boardId,
            statusId,
            creatorId: null,
          });
          yield* insertDeferredEmailSubscription({
            id: `sub_${n}`,
            organizationId,
            email: `jane.${n}@example.com`,
            postId: `post_${n}`,
          });

          const counts = yield* linkShadowUser({
            shadowUserId: shadow,
            realUserId: real,
            deleteShadowUser: true,
          });

          expect(counts.subscriptionsActivated).toBe(1);
          expect((yield* getEmailSubscriptionById(`sub_${n}`))?.state).toBe(
            "active"
          );
        })
    );

    it.effect(
      "leaves deferred subscriptions deferred when the surviving account has no access",
      () =>
        Effect.gen(function* () {
          const n = nextTestRun();
          const organizationId = yield* makeOrganization();
          const real = `unverified_${n}`;
          const shadow = `shadow_${n}`;
          // Unverified global account: fails the eligibility gate entirely.
          yield* insertRealUser({
            id: real,
            email: `jane.${n}@example.com`,
            emailVerified: false,
          });
          yield* insertShadowUser({
            id: shadow,
            email: `jane.${n}@example.com`,
            organizationId,
          });
          yield* insertContact({
            id: `contact_${n}`,
            organizationId,
            email: `jane.${n}@example.com`,
            userId: shadow,
          });
          const { boardId, statusId } =
            yield* makeBoardAndStatus(organizationId);
          yield* insertPost({
            id: `post_${n}`,
            organizationId,
            boardId,
            statusId,
            creatorId: null,
          });
          yield* insertDeferredEmailSubscription({
            id: `sub_${n}`,
            organizationId,
            email: `jane.${n}@example.com`,
            postId: `post_${n}`,
          });

          const counts = yield* linkShadowUser({
            shadowUserId: shadow,
            realUserId: real,
            deleteShadowUser: true,
          });

          expect(counts.subscriptionsActivated).toBe(0);
          expect((yield* getEmailSubscriptionById(`sub_${n}`))?.state).toBe(
            "deferred_no_access"
          );
          // An ineligible account claims nothing: the email contact row is
          // left exactly as the deferred subscription created it.
          const emailContact = yield* getEmailContactById(`sub_${n}`);
          expect(emailContact?.userId).toBeNull();
          expect(emailContact?.verificationState).toBe("pending");
        })
    );

    it.effect("refuses to heal into an account that does not exist", () =>
      Effect.gen(function* () {
        const n = nextTestRun();
        const organizationId = yield* makeOrganization();
        const shadow = `shadow_${n}`;
        yield* insertShadowUser({
          id: shadow,
          email: `jane.${n}@example.com`,
          organizationId,
        });
        yield* insertContact({
          id: `contact_${n}`,
          organizationId,
          email: `jane.${n}@example.com`,
          userId: shadow,
        });

        const error = yield* Effect.flip(
          linkShadowUser({
            shadowUserId: shadow,
            realUserId: `missing_${n}`,
            deleteShadowUser: true,
          })
        );

        expect(error).toBeInstanceOf(SubjectNotFoundError);
        // Nothing moved: the failed program leaves no partial state behind.
        expect((yield* getContactById(`contact_${n}`))?.userId).toBe(shadow);
        expect(yield* getUserById(shadow)).toBeDefined();
      })
    );

    it.effect("no-ops when both ids are the same user", () =>
      Effect.gen(function* () {
        const counts = yield* linkShadowUser({
          shadowUserId: "user_same",
          realUserId: "user_same",
          deleteShadowUser: true,
        });
        expect(counts).toEqual({
          contacts: 0,
          posts: 0,
          upvotesMoved: 0,
          upvotesDropped: 0,
          comments: 0,
          postSubscriptionsMoved: 0,
          postSubscriptionsDropped: 0,
          subscriptionsActivated: 0,
        });
      })
    );

    it.effect(
      "legacy plugin path reassigns contacts and posts without deleting the anonymous user",
      () =>
        Effect.gen(function* () {
          const n = nextTestRun();
          const organizationId = yield* makeOrganization();
          const real = `real_${n}`;
          const anonymous = `anonymous_${n}`;
          yield* insertRealUser({
            id: real,
            email: `jane.${n}@example.com`,
          });
          yield* insertShadowUser({
            id: anonymous,
            email: `jane.${n}@example.com`,
            organizationId,
          });
          const { boardId, statusId } =
            yield* makeBoardAndStatus(organizationId);
          yield* insertPost({
            id: `post_${n}`,
            organizationId,
            boardId,
            statusId,
            creatorId: anonymous,
          });
          yield* insertContact({
            id: `contact_${n}`,
            organizationId,
            email: `jane.${n}@example.com`,
            userId: anonymous,
          });

          yield* linkAnonymousAccount({
            anonymousUserId: anonymous,
            newUserId: real,
          });

          expect((yield* getContactById(`contact_${n}`))?.userId).toBe(real);
          expect((yield* getPostById(`post_${n}`))?.creatorId).toBe(real);
          // The better-auth plugin performs the cleanup itself afterwards.
          expect(yield* getUserById(anonymous)).toBeDefined();
        })
    );
  });

  layer(TestLayer)("healShadowsForVerifiedUser", (it) => {
    it.effect(
      "heals every organization whose contact on the account email points at a shadow",
      () =>
        Effect.gen(function* () {
          const n = nextTestRun();
          const [org1, org2] = [
            yield* makeOrganization(),
            yield* makeOrganization(),
          ];
          const real = `real_${n}`;
          const email = `jane.${n}@example.com`;
          yield* insertRealUser({ id: real, email });
          yield* insertMembership({
            id: `membership_${n}_1`,
            organizationId: org1,
            userId: real,
          });
          yield* insertMembership({
            id: `membership_${n}_2`,
            organizationId: org2,
            userId: real,
          });
          for (const [index, organizationId] of [org1, org2].entries()) {
            yield* insertShadowUser({
              id: `shadow_${n}_${index}`,
              email,
              organizationId,
            });
            yield* insertContact({
              id: `contact_${n}_${index}`,
              organizationId,
              email,
              userId: `shadow_${n}_${index}`,
            });
            const { boardId, statusId } =
              yield* makeBoardAndStatus(organizationId);
            yield* insertPost({
              id: `post_${n}_${index}`,
              organizationId,
              boardId,
              statusId,
              creatorId: `shadow_${n}_${index}`,
            });
          }

          const summary = yield* healShadowsForVerifiedUser({ userId: real });

          expect([...summary.organizationIds].sort()).toEqual(
            [org1, org2].sort()
          );
          expect(summary.totals.contacts).toBe(2);
          expect(summary.totals.posts).toBe(2);
          // Each organization heals independently: both shadows are consumed.
          expect(yield* getUserById(`shadow_${n}_0`)).toBeUndefined();
          expect(yield* getUserById(`shadow_${n}_1`)).toBeUndefined();
          expect((yield* getPostById(`post_${n}_0`))?.creatorId).toBe(real);
          expect((yield* getPostById(`post_${n}_1`))?.creatorId).toBe(real);
        })
    );

    it.effect(
      "heals a non-member customer signup discovered by contact email alone",
      () =>
        Effect.gen(function* () {
          const n = nextTestRun();
          const organizationId = yield* makeOrganization();
          // The customer signs up but never joins the workspace as a member:
          // discovery must come from the contact record, not memberships.
          const real = `real_${n}`;
          yield* insertRealUser({
            id: real,
            email: `jane.${n}@example.com`,
          });
          const shadow = `shadow_${n}`;
          yield* insertShadowUser({
            id: shadow,
            email: `jane.${n}@example.com`,
            organizationId,
          });
          yield* insertContact({
            id: `contact_${n}`,
            organizationId,
            email: `jane.${n}@example.com`,
            userId: shadow,
          });
          const { boardId, statusId } =
            yield* makeBoardAndStatus(organizationId);
          yield* insertPost({
            id: `post_${n}`,
            organizationId,
            boardId,
            statusId,
            creatorId: shadow,
          });

          const summary = yield* healShadowsForVerifiedUser({ userId: real });

          expect(summary.organizationIds).toEqual([organizationId]);
          expect(summary.totals.contacts).toBe(1);
          expect(summary.totals.posts).toBe(1);
          expect(yield* getUserById(shadow)).toBeUndefined();
          expect((yield* getPostById(`post_${n}`))?.creatorId).toBe(real);
        })
    );

    it.effect("does nothing when no contact matches the account email", () =>
      Effect.gen(function* () {
        const n = nextTestRun();
        const organizationId = yield* makeOrganization();
        const real = `real_${n}`;
        const shadow = `shadow_${n}`;
        yield* insertRealUser({
          id: real,
          email: `john.${n}@example.com`,
        });
        yield* insertMembership({
          id: `membership_${n}`,
          organizationId,
          userId: real,
        });
        yield* insertShadowUser({
          id: shadow,
          email: `jane.${n}@example.com`,
          organizationId,
        });
        yield* insertContact({
          id: `contact_${n}`,
          organizationId,
          email: `jane.${n}@example.com`,
          userId: shadow,
        });

        const summary = yield* healShadowsForVerifiedUser({ userId: real });

        expect(summary.organizationIds).toEqual([]);
        // Different email ⇒ the shadow identity is never claimed.
        expect(yield* getUserById(shadow)).toBeDefined();
        expect((yield* getContactById(`contact_${n}`))?.userId).toBe(shadow);
      })
    );

    it.effect(
      "never consumes a contact whose linked user is not a shadow",
      () =>
        Effect.gen(function* () {
          const n = nextTestRun();
          const organizationId = yield* makeOrganization();
          const real = `real_${n}`;
          const portal = `portal_${n}`;
          yield* insertRealUser({
            id: real,
            email: `jane.${n}@example.com`,
          });
          yield* insertMembership({
            id: `membership_${n}`,
            organizationId,
            userId: real,
          });
          yield* insertSsoPortalUser({
            id: portal,
            email: `jane.${n}@example.com`,
            organizationId,
          });
          yield* insertContact({
            id: `contact_${n}`,
            organizationId,
            email: `jane.${n}@example.com`,
            userId: portal,
          });

          const summary = yield* healShadowsForVerifiedUser({ userId: real });

          expect(summary.organizationIds).toEqual([]);
          // SSO portal identities belong to their human, not to this account.
          expect(yield* getUserById(portal)).toBeDefined();
          expect((yield* getContactById(`contact_${n}`))?.userId).toBe(portal);
        })
    );

    it.effect("ignores accounts whose email is not verified", () =>
      Effect.gen(function* () {
        const n = nextTestRun();
        const organizationId = yield* makeOrganization();
        const real = `unverified_${n}`;
        const shadow = `shadow_${n}`;
        yield* insertRealUser({
          id: real,
          email: `jane.${n}@example.com`,
          emailVerified: false,
        });
        yield* insertMembership({
          id: `membership_${n}`,
          organizationId,
          userId: real,
        });
        yield* insertShadowUser({
          id: shadow,
          email: `jane.${n}@example.com`,
          organizationId,
        });
        yield* insertContact({
          id: `contact_${n}`,
          organizationId,
          email: `jane.${n}@example.com`,
          userId: shadow,
        });

        const summary = yield* healShadowsForVerifiedUser({ userId: real });

        expect(summary.organizationIds).toEqual([]);
        expect(yield* getUserById(shadow)).toBeDefined();
      })
    );
  });
});
