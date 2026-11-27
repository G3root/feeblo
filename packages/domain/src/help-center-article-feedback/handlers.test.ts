import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  HelpCenterArticleId,
  HelpCenterTopicId,
  type LegidOf,
  SiteId,
  WorkspaceId,
} from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { EntitlementPolicy } from "../entitlement/policies";
import { HelpCenterArticleRepository } from "../help-center-article/repository";
import {
  CurrentSession,
  OptionalCurrentSession,
  type Session,
} from "../session-middleware";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { HelpCenterArticleFeedbackRpcHandlersEffect } from "./handlers";
import { HelpCenterArticleFeedbackRepository } from "./repository";

describe("HelpCenterArticleFeedbackRpcHandlers", () => {
  type Fixture = {
    articleId: LegidOf<"HelpCenterArticleId">;
    membershipId: string;
    organizationId: LegidOf<"WorkspaceId">;
    userId: string;
  };

  const makeSession = (fixture: Fixture, isMember = true): Session => ({
    user: {
      id: fixture.userId,
      email: "user@example.com",
      name: "Test User",
      restrictedToOrganizationId: null,
    },
    session: { userId: fixture.userId, token: "test-token" },
    organizations: [{ id: fixture.organizationId }],
    memberships: isMember
      ? [
          {
            membershipId: fixture.membershipId,
            organizationId: fixture.organizationId,
            role: "owner",
          },
        ]
      : [],
  });

  /** A stable, UUID-shaped id per fixture and voter slot, so keys never clash. */
  const visitorIdFor = (fixture: Fixture, slot = 0) =>
    `00000000-0000-4000-8000-${`${fixture.organizationId.slice(-9)}${slot}`.padStart(12, "0")}`;

  const makeFixture = () =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const siteId = yield* SiteId.generate;
      const topicId = yield* HelpCenterTopicId.generate;
      const articleId = yield* HelpCenterArticleId.generate;
      const userId = `user_${organizationId}`;
      const membershipId = `membership_${organizationId}`;
      const now = yield* DateTime.nowAsDate;

      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Test organization",
        slug: organizationId,
        logo: null,
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
      yield* db.insert(schema.siteTable).values({
        id: siteId,
        name: "Test site",
        subdomain: `test-${organizationId}`,
        customDomain: null,
        changelogVisibility: "PUBLIC",
        roadmapVisibility: "PUBLIC",
        helpCenterVisibility: "PUBLIC",
        hidePoweredBy: false,
        organizationId,
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.helpCenterTopicTable).values({
        id: topicId,
        organizationId,
        name: "Getting started",
        slug: "getting-started",
        description: null,
        icon: null,
        position: 0,
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.helpCenterArticleTable).values({
        id: articleId,
        organizationId,
        topicId,
        slug: "counted",
        title: "Counted",
        content: "Body",
        excerpt: "Body",
        status: "published",
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      return {
        articleId,
        membershipId,
        organizationId,
        userId,
      } satisfies Fixture;
    });

  const Repositories = Layer.mergeAll(
    HelpCenterArticleFeedbackRepository.layer,
    HelpCenterArticleRepository.layer,
    SiteRepository.layer,
    WorkspaceRepository.layer
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));

  const Entitlements = EntitlementPolicy.layer.pipe(
    Layer.provide(Repositories)
  );

  const Policies = SitePolicy.layer.pipe(
    Layer.provide(Entitlements),
    Layer.provide(Repositories)
  );

  const TestLayer = Layer.mergeAll(
    Repositories,
    Entitlements,
    Policies,
    Database.PgliteDatabaseLive
  );

  /** The stored verdict rows for one article. */
  const readVerdicts = (articleId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;

      return yield* db
        .select({
          userId: schema.helpCenterArticleFeedbackTable.userId,
          visitorId: schema.helpCenterArticleFeedbackTable.visitorId,
          helpful: schema.helpCenterArticleFeedbackTable.helpful,
          reason: schema.helpCenterArticleFeedbackTable.reason,
        })
        .from(schema.helpCenterArticleFeedbackTable)
        .where(eq(schema.helpCenterArticleFeedbackTable.articleId, articleId));
    });

  /** The day's verdict bucket for one article. */
  const readDaily = (articleId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;

      return yield* db
        .select({
          helpful: schema.helpCenterArticleDailyTable.helpfulVerdicts,
          unhelpful: schema.helpCenterArticleDailyTable.unhelpfulVerdicts,
        })
        .from(schema.helpCenterArticleDailyTable)
        .where(eq(schema.helpCenterArticleDailyTable.articleId, articleId));
    });

  layer(TestLayer)("handlers", (it) => {
    it.effect("records an anonymous verdict once per visitor", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleFeedbackRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const visitorId = visitorIdFor(fixture);

        const cast = () =>
          handlers
            .SetHelpCenterArticleFeedback({
              organizationId: fixture.organizationId,
              articleId: fixture.articleId,
              helpful: true,
              reason: null,
              visitorId,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

        const first = yield* cast();
        const second = yield* cast();

        expect(first.helpfulCount).toBe(1);
        // The important assertion: a second vote from the same visitor is the
        // *same row* flipped, not a second row. A plain
        // `unique(article_id, user_id)` would have allowed one per request
        // here, because every NULL compares distinct.
        expect(second.helpfulCount).toBe(1);
        expect(second.notHelpfulCount).toBe(0);

        const rows = yield* readVerdicts(fixture.articleId);
        expect(rows).toHaveLength(1);
      })
    );

    it.effect("flips one verdict from helpful to not helpful in place", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleFeedbackRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const visitorId = visitorIdFor(fixture);

        yield* handlers
          .SetHelpCenterArticleFeedback({
            organizationId: fixture.organizationId,
            articleId: fixture.articleId,
            helpful: true,
            reason: null,
            visitorId,
          })
          .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

        const flipped = yield* handlers
          .SetHelpCenterArticleFeedback({
            organizationId: fixture.organizationId,
            articleId: fixture.articleId,
            helpful: false,
            reason: "The screenshots are out of date.",
            visitorId,
          })
          .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

        expect(flipped.helpfulCount).toBe(0);
        expect(flipped.notHelpfulCount).toBe(1);
        expect(flipped.mine).toBe(false);

        const rows = yield* readVerdicts(fixture.articleId);
        expect(rows).toHaveLength(1);
      })
    );

    it.effect("counts each verdict on the day it was cast", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleFeedbackRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const visitorId = visitorIdFor(fixture);

        const cast = (helpful: boolean) =>
          handlers
            .SetHelpCenterArticleFeedback({
              organizationId: fixture.organizationId,
              articleId: fixture.articleId,
              helpful,
              reason: helpful ? null : "Wrong section.",
              visitorId,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

        yield* cast(true);
        yield* cast(false);

        const rows = yield* readDaily(fixture.articleId);

        // A flip is a second verdict cast, not a correction of the first: the
        // bucket counts judgments made, which is what "was this helpful"
        // measures. The standing distribution is the feedback table itself.
        expect(rows).toStrictEqual([{ helpful: 1, unhelpful: 1 }]);
      })
    );

    it.effect("counts a repeated helpful verdict only once", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleFeedbackRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const visitorId = visitorIdFor(fixture);

        const cast = () =>
          handlers
            .SetHelpCenterArticleFeedback({
              organizationId: fixture.organizationId,
              articleId: fixture.articleId,
              helpful: true,
              reason: null,
              visitorId,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

        yield* cast();
        yield* cast();

        // Pressing Yes twice is one opinion. Counting requests instead of
        // judgments would inflate today's bucket by a double-click.
        const rows = yield* readDaily(fixture.articleId);
        expect(rows).toStrictEqual([{ helpful: 1, unhelpful: 0 }]);
      })
    );

    it.effect(
      "records a reason sent after a no vote without counting a second verdict",
      () =>
        Effect.gen(function* () {
          const handlers = yield* HelpCenterArticleFeedbackRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const visitorId = visitorIdFor(fixture);

          const cast = (reason: string | null) =>
            handlers
              .SetHelpCenterArticleFeedback({
                organizationId: fixture.organizationId,
                articleId: fixture.articleId,
                helpful: false,
                reason,
                visitorId,
              })
              .pipe(
                Effect.provideService(OptionalCurrentSession, Option.none())
              );

          yield* cast(null);
          yield* cast("The screenshots are out of date.");

          const rows = yield* readVerdicts(fixture.articleId);

          expect(rows).toHaveLength(1);
          expect(rows[0]?.reason).toBe("The screenshots are out of date.");
          // The second request carried the same verdict with a reason; it is
          // the same judgment, so the day's unhelpful bucket stays at one.
          const daily = yield* readDaily(fixture.articleId);
          expect(daily).toStrictEqual([{ helpful: 0, unhelpful: 1 }]);
        })
    );

    it.effect("clears the reason when the verdict flips back to helpful", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleFeedbackRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const visitorId = visitorIdFor(fixture);
        const db = yield* currentDb;

        yield* handlers
          .SetHelpCenterArticleFeedback({
            organizationId: fixture.organizationId,
            articleId: fixture.articleId,
            helpful: false,
            reason: "Missing a step.",
            visitorId,
          })
          .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

        yield* handlers
          .SetHelpCenterArticleFeedback({
            organizationId: fixture.organizationId,
            articleId: fixture.articleId,
            helpful: true,
            reason: "Missing a step.",
            visitorId,
          })
          .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

        const stored = yield* db
          .select({
            helpful: schema.helpCenterArticleFeedbackTable.helpful,
            reason: schema.helpCenterArticleFeedbackTable.reason,
          })
          .from(schema.helpCenterArticleFeedbackTable)
          .where(
            eq(
              schema.helpCenterArticleFeedbackTable.articleId,
              fixture.articleId
            )
          );

        // A reason explains the unhelpful vote it was written for, so a
        // helpful verdict cannot keep one.
        expect(stored).toHaveLength(1);
        expect(stored[0]?.helpful).toBe(true);
        expect(stored[0]?.reason).toBeNull();
      })
    );

    it.effect("migrates an anonymous verdict to the account row", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleFeedbackRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const visitorId = visitorIdFor(fixture);

        // An anonymous No, then the same person signs in and presses Yes. The
        // account row supersedes the browser-keyed one; keeping both would
        // count one reader twice and make the tally contradict the one verdict
        // the reader remembers casting.
        yield* handlers
          .SetHelpCenterArticleFeedback({
            organizationId: fixture.organizationId,
            articleId: fixture.articleId,
            helpful: false,
            reason: "Missing a step.",
            visitorId,
          })
          .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

        const signedIn = yield* handlers
          .SetHelpCenterArticleFeedback({
            organizationId: fixture.organizationId,
            articleId: fixture.articleId,
            helpful: true,
            reason: null,
            visitorId,
          })
          .pipe(
            Effect.provideService(
              OptionalCurrentSession,
              Option.some(makeSession(fixture))
            )
          );

        expect(signedIn.mine).toBe(true);
        expect(signedIn.helpfulCount).toBe(1);
        expect(signedIn.notHelpfulCount).toBe(0);

        const rows = yield* readVerdicts(fixture.articleId);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          userId: fixture.userId,
          visitorId: null,
          helpful: true,
          reason: null,
        });

        // The anonymous No and the signed-in Yes are two judgments, so the day
        // buckets one of each: the migration deletes a row, not a judgment.
        const daily = yield* readDaily(fixture.articleId);
        expect(daily).toStrictEqual([{ helpful: 1, unhelpful: 1 }]);
      })
    );

    it.effect("does not count the sign-in migration as a second verdict", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleFeedbackRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const visitorId = visitorIdFor(fixture);

        const cast = () =>
          handlers.SetHelpCenterArticleFeedback({
            organizationId: fixture.organizationId,
            articleId: fixture.articleId,
            helpful: true,
            reason: null,
            visitorId,
          });

        yield* cast().pipe(
          Effect.provideService(OptionalCurrentSession, Option.none())
        );
        yield* cast().pipe(
          Effect.provideService(
            OptionalCurrentSession,
            Option.some(makeSession(fixture))
          )
        );

        // Same verdict on both sides of signing in: the repository reads the
        // anonymous row as the previous verdict, so the migration must not add
        // a second helpful judgment to today's bucket.
        const daily = yield* readDaily(fixture.articleId);
        expect(daily).toStrictEqual([{ helpful: 1, unhelpful: 0 }]);
      })
    );

    it.effect(
      "shows a signed-in reader the verdict they cast anonymously",
      () =>
        Effect.gen(function* () {
          const handlers = yield* HelpCenterArticleFeedbackRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const visitorId = visitorIdFor(fixture);

          yield* handlers
            .SetHelpCenterArticleFeedback({
              organizationId: fixture.organizationId,
              articleId: fixture.articleId,
              helpful: false,
              reason: "Missing a step.",
              visitorId,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

          // Reading before the signed-in vote falls back to the browser-keyed
          // row, so signing in does not appear to erase the vote.
          const read = yield* handlers
            .GetHelpCenterArticleFeedbackPublic({
              organizationId: fixture.organizationId,
              articleId: fixture.articleId,
              visitorId,
            })
            .pipe(
              Effect.provideService(
                OptionalCurrentSession,
                Option.some(makeSession(fixture))
              )
            );

          expect(read.mine).toBe(false);
          expect(read.helpfulCount).toBe(0);
          expect(read.notHelpfulCount).toBe(1);
          // Views belong to the article payload; a verdict read must not restate
          // a number it cannot change.
          expect(read).not.toHaveProperty("viewCount");
        })
    );

    it.effect("refuses a verdict with no identity at all", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleFeedbackRpcHandlersEffect;
        const fixture = yield* makeFixture();

        const error = yield* Effect.flip(
          handlers
            .SetHelpCenterArticleFeedback({
              organizationId: fixture.organizationId,
              articleId: fixture.articleId,
              helpful: true,
              reason: null,
              visitorId: null,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()))
        );

        expect(error._tag).toBe("BadRequestError");
      })
    );

    it.effect("refuses a verdict on an article a reader cannot open", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleFeedbackRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const db = yield* currentDb;

        yield* db
          .update(schema.helpCenterArticleTable)
          .set({ status: "draft", publishedAt: null })
          .where(eq(schema.helpCenterArticleTable.id, fixture.articleId));

        const error = yield* Effect.flip(
          handlers
            .SetHelpCenterArticleFeedback({
              organizationId: fixture.organizationId,
              articleId: fixture.articleId,
              helpful: true,
              reason: null,
              visitorId: visitorIdFor(fixture),
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()))
        );

        // A draft has no public page, so a vote on it would both count a page
        // nobody can open and confirm the draft exists.
        expect(error._tag).toBe("NotFoundError");
      })
    );

    it.effect("answers NotFound for a draft's tally", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleFeedbackRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const db = yield* currentDb;

        yield* db
          .update(schema.helpCenterArticleTable)
          .set({ status: "draft", publishedAt: null })
          .where(eq(schema.helpCenterArticleTable.id, fixture.articleId));

        const error = yield* Effect.flip(
          handlers
            .GetHelpCenterArticleFeedbackPublic({
              organizationId: fixture.organizationId,
              articleId: fixture.articleId,
              visitorId: visitorIdFor(fixture),
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()))
        );

        // A count for a page nobody can open is both a wrong number and a
        // confirmation that the draft exists.
        expect(error._tag).toBe("NotFoundError");
      })
    );

    it.effect("keeps the verdict list to managers", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleFeedbackRpcHandlersEffect;
        const fixture = yield* makeFixture();

        const error = yield* Effect.flip(
          handlers
            .ListHelpCenterArticleFeedback({
              organizationId: fixture.organizationId,
              articleId: fixture.articleId,
            })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture, false))
            )
        );

        expect(error._tag).toBe("PolicyDenied");
      })
    );

    it.effect("filters the dashboard list to reasoned unhelpful verdicts", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleFeedbackRpcHandlersEffect;
        const fixture = yield* makeFixture();

        const cast = (helpful: boolean, reason: string | null, slot: number) =>
          handlers
            .SetHelpCenterArticleFeedback({
              organizationId: fixture.organizationId,
              articleId: fixture.articleId,
              helpful,
              reason,
              visitorId: visitorIdFor(fixture, slot),
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));

        yield* cast(true, null, 0);
        yield* cast(false, null, 1);
        yield* cast(false, "The screenshots are out of date.", 2);

        const list = (args: { reasonsOnly?: boolean; limit?: number }) =>
          handlers
            .ListHelpCenterArticleFeedback({
              organizationId: fixture.organizationId,
              articleId: fixture.articleId,
              ...args,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

        // The unfiltered list keeps its shape: every verdict, newest first,
        // bounded by the default limit rather than by the reason filter.
        const everything = yield* list({});
        expect(everything).toHaveLength(3);

        // The reason panel is unhelpful verdicts that left text: a helpful
        // verdict cannot carry a reason, and a bare No has nothing to act on.
        const reasons = yield* list({ reasonsOnly: true });
        expect(reasons).toHaveLength(1);
        expect(reasons[0]?.helpful).toBe(false);
        expect(reasons[0]?.reason).toBe("The screenshots are out of date.");

        const bounded = yield* list({ limit: 1 });
        expect(bounded).toHaveLength(1);
      })
    );
  });
});
