import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { type LegidOf, WorkspaceId } from "@feeblo/id";
import type { Role } from "@feeblo/permissions";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CurrentSession, type Session } from "../session-middleware";
import { InsightsRpcHandlersEffect } from "./handlers";
import { InsightsRepository } from "./repository";

describe("InsightsRpcHandlers", () => {
  type Fixture = {
    boardId: string;
    defaultStatusId: string;
    membershipId: string;
    organizationId: LegidOf<"WorkspaceId">;
    plannedStatusId: string;
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

  const makeFixture = () =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const now = yield* DateTime.nowAsDate;
      const userId = `user_${organizationId}`;
      const membershipId = `member_${organizationId}`;
      const boardId = `board_${organizationId}`;
      const defaultStatusId = `status_pending_${organizationId}`;
      const plannedStatusId = `status_planned_${organizationId}`;

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
        name: "Feedback",
        slug: "feedback",
        visibility: "PUBLIC",
        organizationId,
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.postStatusTable).values([
        {
          id: defaultStatusId,
          type: "PENDING",
          label: "Pending",
          orderIndex: 0,
          isDefault: true,
          organizationId,
        },
        {
          id: plannedStatusId,
          type: "PLANNED",
          label: "",
          orderIndex: 1,
          isDefault: false,
          organizationId,
        },
      ]);

      return {
        boardId,
        defaultStatusId,
        membershipId,
        organizationId,
        plannedStatusId,
        userId,
      } satisfies Fixture;
    });

  const addMemberUser = (
    fixture: Fixture,
    suffix: string,
    role: Role = "manager"
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const userId = `user_${fixture.organizationId}_${suffix}`;
      const membershipId = `member_${fixture.organizationId}_${suffix}`;
      const now = yield* DateTime.nowAsDate;
      yield* db.insert(schema.userTable).values({
        id: userId,
        email: `${userId}@example.com`,
        name: `Test ${suffix}`,
      });
      yield* db.insert(schema.memberTable).values({
        id: membershipId,
        organizationId: fixture.organizationId,
        userId,
        role,
        createdAt: now,
      });
      return { membershipId, userId };
    });

  const addPost = (
    fixture: Fixture,
    suffix: string,
    overrides: Partial<typeof schema.postTable.$inferInsert> = {}
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const now = yield* DateTime.nowAsDate;
      const id = `post_${fixture.organizationId}_${suffix}`;
      yield* db.insert(schema.postTable).values({
        id,
        title: `Post ${suffix}`,
        slug: `post-${suffix}`,
        content: "Body",
        boardId: fixture.boardId,
        statusId: fixture.defaultStatusId,
        organizationId: fixture.organizationId,
        createdAt: now,
        updatedAt: now,
        ...overrides,
      });
      return id;
    });

  const addStatusChange = (
    fixture: Fixture,
    postId: string,
    at: Date,
    suffix: string
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.postActivityTable).values({
        id: `activity_status_${postId}_${suffix}`,
        organizationId: fixture.organizationId,
        postId,
        actorId: fixture.userId,
        actorMemberId: fixture.membershipId,
        kind: "STATUS_CHANGED",
        previousValue: fixture.defaultStatusId,
        nextValue: fixture.plannedStatusId,
        createdAt: at,
      });
    });

  const addVote = (
    fixture: Fixture,
    postId: string,
    suffix: string,
    args: { createdAt?: Date; userId?: string } = {}
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const now = yield* DateTime.nowAsDate;
      yield* db.insert(schema.upvoteTable).values({
        id: `upvote_${postId}_${suffix}`,
        userId: args.userId ?? fixture.userId,
        postId,
        organizationId: fixture.organizationId,
        createdAt: args.createdAt ?? now,
      });
    });

  const TestLayer = InsightsRepository.layer.pipe(
    Layer.provideMerge(Database.PgliteDatabaseLive)
  );

  layer(TestLayer)("handlers", (it) => {
    describe("GetWorkspaceInsights", () => {
      it.effect("rejects a user without a membership", () =>
        Effect.gen(function* () {
          const handlers = yield* InsightsRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const error = yield* Effect.flip(
            handlers
              .GetWorkspaceInsights({
                organizationId: fixture.organizationId,
                range: "30d",
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

      it.effect("counts posts and votes inside the window only", () =>
        Effect.gen(function* () {
          const handlers = yield* InsightsRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const now = yield* DateTime.now;
          const tenDaysAgo = DateTime.toDate(
            DateTime.subtract({ days: 10 })(now)
          );

          const recentPost = yield* addPost(fixture, "recent");
          const oldPost = yield* addPost(fixture, "old", {
            createdAt: tenDaysAgo,
            updatedAt: tenDaysAgo,
          });
          // Dated after the request's `until`: the window ends now, so a row
          // from the future is not part of it.
          const tomorrow = DateTime.toDate(DateTime.add({ days: 1 })(now));
          yield* addPost(fixture, "future", {
            createdAt: tomorrow,
            updatedAt: tomorrow,
          });
          yield* addVote(fixture, recentPost, "recent");
          yield* addVote(fixture, oldPost, "old");

          const week = yield* handlers
            .GetWorkspaceInsights({
              organizationId: fixture.organizationId,
              range: "7d",
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          const month = yield* handlers
            .GetWorkspaceInsights({
              organizationId: fixture.organizationId,
              range: "30d",
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(week.summary.posts).toBe(1);
          expect(month.summary.posts).toBe(2);
          // The vote on the ten-day-old post was cast today, so both votes are
          // in both windows: the vote metric is about when the vote happened,
          // not when its post was written.
          expect(week.summary.votes).toBe(2);
          expect(month.summary.votes).toBe(2);
          // Current state has no window: the future-dated post exists now,
          // even though it is outside the window's counts.
          expect(month.summary.activePosts).toBe(3);
          expect(month.summary.unassignedPosts).toBe(3);
        })
      );

      it.effect("reports the median first response over responded posts", () =>
        Effect.gen(function* () {
          const handlers = yield* InsightsRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const now = yield* DateTime.now;
          const created = DateTime.subtract({ hours: 10 })(now);
          const createdAt = DateTime.toDate(created);

          const slow = yield* addPost(fixture, "slow", {
            createdAt,
            updatedAt: createdAt,
          });
          const fast = yield* addPost(fixture, "fast", {
            createdAt,
            updatedAt: createdAt,
          });
          yield* addPost(fixture, "silent", {
            createdAt,
            updatedAt: createdAt,
          });
          // Each post gets a later change too, so a median built from the
          // latest (or the maximum) would report 5h instead of 1.5h.
          yield* addStatusChange(
            fixture,
            slow,
            DateTime.toDate(DateTime.add({ hours: 4 })(created)),
            "later"
          );
          yield* addStatusChange(
            fixture,
            slow,
            DateTime.toDate(DateTime.add({ hours: 1 })(created)),
            "earlier"
          );
          yield* addStatusChange(
            fixture,
            fast,
            DateTime.toDate(DateTime.add({ hours: 2 })(created)),
            "first"
          );
          yield* addStatusChange(
            fixture,
            fast,
            DateTime.toDate(DateTime.add({ hours: 6 })(created)),
            "later"
          );

          const insights = yield* handlers
            .GetWorkspaceInsights({
              organizationId: fixture.organizationId,
              range: "30d",
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(insights.summary.respondedPosts).toBe(2);
          // Median of the first responses: 1h and 2h.
          expect(insights.summary.medianFirstResponseSeconds).toBe(90 * 60);
        })
      );

      it.effect("has no first response when nothing was answered", () =>
        Effect.gen(function* () {
          const handlers = yield* InsightsRpcHandlersEffect;
          const fixture = yield* makeFixture();
          yield* addPost(fixture, "unanswered");

          const insights = yield* handlers
            .GetWorkspaceInsights({
              organizationId: fixture.organizationId,
              range: "30d",
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(insights.summary.respondedPosts).toBe(0);
          expect(insights.summary.medianFirstResponseSeconds).toBeNull();
        })
      );

      it.effect("counts only active posts in the status mix", () =>
        Effect.gen(function* () {
          const handlers = yield* InsightsRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const now = yield* DateTime.nowAsDate;

          yield* addPost(fixture, "active");
          const survivor = yield* addPost(fixture, "survivor");
          yield* addPost(fixture, "merged", {
            archivedAt: now,
            mergedIntoPostId: survivor,
            mergedAt: now,
          });
          yield* addPost(fixture, "archived", { archivedAt: now });

          const insights = yield* handlers
            .GetWorkspaceInsights({
              organizationId: fixture.organizationId,
              range: "30d",
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const pending = insights.statusMix.find(
            (slice) => slice.statusId === fixture.defaultStatusId
          );
          const neverUsed = insights.statusMix.find(
            (slice) => slice.statusId === fixture.plannedStatusId
          );

          expect(pending?.posts).toBe(2);
          // A status with nothing in it is still a column on the board, and it
          // falls back to its type when the workspace has not named it.
          expect(neverUsed).toEqual({
            statusId: fixture.plannedStatusId,
            type: "PLANNED",
            label: "PLANNED",
            color: null,
            posts: 0,
          });
        })
      );

      it.effect("lists untouched posts oldest first", () =>
        Effect.gen(function* () {
          const handlers = yield* InsightsRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const now = yield* DateTime.now;
          const older = DateTime.toDate(DateTime.subtract({ days: 8 })(now));
          const newest = DateTime.toDate(DateTime.subtract({ days: 2 })(now));

          // Edited recently but still has no assignee, status change, or
          // comment: `updated_at` is not the measure of attention.
          const oldest = yield* addPost(fixture, "oldest", {
            createdAt: older,
            updatedAt: newest,
          });
          const touchedByStatus = yield* addPost(fixture, "status", {
            createdAt: older,
            updatedAt: older,
          });
          const touchedByComment = yield* addPost(fixture, "comment", {
            createdAt: older,
            updatedAt: older,
          });
          const assigned = yield* addPost(fixture, "assigned", {
            createdAt: older,
            updatedAt: older,
            assigneeMemberId: fixture.membershipId,
          });
          const newer = yield* addPost(fixture, "newer", {
            createdAt: newest,
            updatedAt: newest,
          });

          yield* addStatusChange(
            fixture,
            touchedByStatus,
            daysBefore(now, 7),
            "first"
          );
          const db = yield* currentDb;
          yield* db.insert(schema.commentTable).values({
            id: `comment_${touchedByComment}`,
            content: "Any update?",
            organizationId: fixture.organizationId,
            postId: touchedByComment,
            userId: fixture.userId,
            createdAt: daysBefore(now, 3),
          });

          const insights = yield* handlers
            .GetWorkspaceInsights({
              organizationId: fixture.organizationId,
              range: "30d",
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(insights.untouchedPosts.map((post) => post.id)).toEqual([
            oldest,
            newer,
          ]);
          expect(
            insights.untouchedPosts.some((post) => post.id === assigned)
          ).toBe(false);
        })
      );

      it.effect("fills every day in the window", () =>
        Effect.gen(function* () {
          const handlers = yield* InsightsRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const now = yield* DateTime.now;
          const twoDaysAgo = DateTime.subtract({ days: 2 })(now);
          const fourDaysAgo = DateTime.subtract({ days: 4 })(now);

          const todayPost = yield* addPost(fixture, "today");
          const earlierPost = yield* addPost(fixture, "two-days-ago", {
            createdAt: DateTime.toDate(twoDaysAgo),
            updatedAt: DateTime.toDate(twoDaysAgo),
          });
          yield* addPost(fixture, "four-days-ago", {
            createdAt: DateTime.toDate(fourDaysAgo),
            updatedAt: DateTime.toDate(fourDaysAgo),
          });
          yield* addVote(fixture, todayPost, "today");
          yield* addVote(fixture, earlierPost, "two-days-ago", {
            createdAt: DateTime.toDate(twoDaysAgo),
          });

          const insights = yield* handlers
            .GetWorkspaceInsights({
              organizationId: fixture.organizationId,
              range: "7d",
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const byDate = new Map(
            insights.volume.map((point) => [point.date, point])
          );
          const today = DateTime.formatIsoDate(now);
          const yesterday = DateTime.formatIsoDate(
            DateTime.subtract({ days: 1 })(now)
          );

          // Today plus the six days before it, each with its own counts.
          expect(insights.volume).toHaveLength(7);
          expect(byDate.get(today)).toEqual({
            date: today,
            posts: 1,
            votes: 1,
          });
          expect(byDate.get(DateTime.formatIsoDate(twoDaysAgo))).toMatchObject({
            posts: 1,
            votes: 1,
          });
          expect(byDate.get(DateTime.formatIsoDate(fourDaysAgo))).toMatchObject(
            { posts: 1, votes: 0 }
          );
          // A day with no activity is still a row.
          expect(byDate.get(yesterday)).toMatchObject({ posts: 0, votes: 0 });
          expect(
            insights.volume.reduce((total, point) => total + point.posts, 0)
          ).toBe(3);
          expect(
            insights.volume.reduce((total, point) => total + point.votes, 0)
          ).toBe(2);
        })
      );

      it.effect("ranks boards, tags, and voters by their activity", () =>
        Effect.gen(function* () {
          const handlers = yield* InsightsRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const db = yield* currentDb;
          const clock = yield* DateTime.now;
          const now = DateTime.toDate(clock);

          const secondBoardId = `board_second_${fixture.organizationId}`;
          yield* db.insert(schema.boardTable).values({
            id: secondBoardId,
            name: "Bugs",
            slug: "bugs",
            visibility: "PUBLIC",
            organizationId: fixture.organizationId,
            createdAt: now,
            updatedAt: now,
          });

          const first = yield* addPost(fixture, "first");
          const second = yield* addPost(fixture, "second", {
            boardId: secondBoardId,
          });
          yield* addPost(fixture, "third", { boardId: secondBoardId });
          // Past `until`, so it must not move the board's window totals.
          const tomorrow = DateTime.toDate(DateTime.add({ days: 1 })(clock));
          yield* addPost(fixture, "future", {
            boardId: secondBoardId,
            createdAt: tomorrow,
            updatedAt: tomorrow,
          });

          const tagId = `tag_${fixture.organizationId}`;
          yield* db.insert(schema.tagTable).values({
            id: tagId,
            name: "Billing",
            slug: "billing",
            organizationId: fixture.organizationId,
          });
          yield* db.insert(schema.postTagTable).values([
            {
              id: `post_tag_${first}`,
              postId: first,
              tagId,
              organizationId: fixture.organizationId,
            },
            {
              id: `post_tag_${second}`,
              postId: second,
              tagId,
              organizationId: fixture.organizationId,
            },
          ]);

          const alpha = yield* addMemberUser(fixture, "alpha");
          const beta = yield* addMemberUser(fixture, "beta");
          // One vote per member per post, so three votes on one post means
          // three voters.
          yield* addVote(fixture, first, "owner-1");
          yield* addVote(fixture, first, "alpha-1", {
            userId: alpha.userId,
          });
          yield* addVote(fixture, first, "beta-1", {
            userId: beta.userId,
          });
          yield* addVote(fixture, second, "owner-2");

          const insights = yield* handlers
            .GetWorkspaceInsights({
              organizationId: fixture.organizationId,
              range: "30d",
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          // One board wins on votes, the other on posts; both totals are
          // reported rather than a single opaque rank score.
          expect(insights.topBoards[0]).toMatchObject({
            id: fixture.boardId,
            posts: 1,
            votes: 3,
          });
          expect(insights.topBoards[1]).toMatchObject({
            id: secondBoardId,
            posts: 2,
            votes: 1,
          });
          expect(insights.topTags).toEqual([
            { id: tagId, name: "Billing", posts: 2 },
          ]);
          expect(insights.topVoters).toHaveLength(3);
          expect(insights.topVoters[0]).toMatchObject({
            name: "Test User",
            votes: 2,
          });
        })
      );

      it.effect("reports a merge rate and refuses to divide by zero", () =>
        Effect.gen(function* () {
          const handlers = yield* InsightsRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const db = yield* currentDb;
          const now = yield* DateTime.nowAsDate;

          const survivor = yield* addPost(fixture, "survivor");
          const duplicate = yield* addPost(fixture, "duplicate", {
            archivedAt: now,
            mergedIntoPostId: survivor,
            mergedAt: now,
          });
          yield* db.insert(schema.postActivityTable).values({
            id: `activity_merged_${duplicate}`,
            organizationId: fixture.organizationId,
            postId: survivor,
            actorId: fixture.userId,
            actorMemberId: fixture.membershipId,
            kind: "POST_MERGED",
            previousValue: null,
            nextValue: duplicate,
            createdAt: now,
          });

          const insights = yield* handlers
            .GetWorkspaceInsights({
              organizationId: fixture.organizationId,
              range: "30d",
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(insights.summary.mergedPosts).toBe(1);
          expect(insights.summary.posts).toBe(2);
          expect(insights.summary.mergeRate).toBe(0.5);

          const emptyOrganizationId = yield* WorkspaceId.generate;
          yield* db.insert(schema.organizationTable).values({
            id: emptyOrganizationId,
            name: "Empty organization",
            slug: emptyOrganizationId,
            createdAt: now,
          });
          yield* db.insert(schema.userTable).values({
            id: `user_${emptyOrganizationId}`,
            email: `${emptyOrganizationId}@example.com`,
            name: "Empty User",
          });
          yield* db.insert(schema.memberTable).values({
            id: `member_${emptyOrganizationId}`,
            organizationId: emptyOrganizationId,
            userId: `user_${emptyOrganizationId}`,
            role: "owner",
            createdAt: now,
          });

          const emptySession: Session = {
            user: {
              id: `user_${emptyOrganizationId}`,
              email: `${emptyOrganizationId}@example.com`,
              name: "Empty User",
              restrictedToOrganizationId: null,
            },
            session: {
              userId: `user_${emptyOrganizationId}`,
              token: "test-token",
            },
            organizations: [{ id: emptyOrganizationId }],
            memberships: [
              {
                membershipId: `member_${emptyOrganizationId}`,
                organizationId: emptyOrganizationId,
                role: "owner",
              },
            ],
          };

          const empty = yield* handlers
            .GetWorkspaceInsights({
              organizationId: emptyOrganizationId,
              range: "7d",
            })
            .pipe(Effect.provideService(CurrentSession, emptySession));

          expect(empty.summary.posts).toBe(0);
          expect(empty.summary.mergeRate).toBeNull();
        })
      );
    });
  });
});

/**
 * A timestamp `days` before `now`, derived from the Effect `Clock` value the
 * test already holds rather than from the wall clock.
 */
function daysBefore(now: DateTime.DateTime, days: number): Date {
  return DateTime.toDate(DateTime.subtract({ days })(now));
}
