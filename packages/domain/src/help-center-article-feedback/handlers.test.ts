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

  /** A stable, UUID-shaped id per fixture, so the vote key is never shared. */
  const visitorIdFor = (fixture: Fixture) =>
    `00000000-0000-4000-8000-${fixture.organizationId.slice(-12).padStart(12, "0")}`;

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
  const countRows = (articleId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;

      return yield* db
        .select({ id: schema.helpCenterArticleFeedbackTable.id })
        .from(schema.helpCenterArticleFeedbackTable)
        .where(eq(schema.helpCenterArticleFeedbackTable.articleId, articleId));
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

        const rows = yield* countRows(fixture.articleId);
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

        const rows = yield* countRows(fixture.articleId);
        expect(rows).toHaveLength(1);
      })
    );

    it.effect("counts each verdict on the day it was cast", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleFeedbackRpcHandlersEffect;
        const db = yield* currentDb;
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

        const rows = yield* db
          .select({
            helpful: schema.helpCenterArticleDailyTable.helpfulVerdicts,
            unhelpful: schema.helpCenterArticleDailyTable.unhelpfulVerdicts,
          })
          .from(schema.helpCenterArticleDailyTable)
          .where(
            eq(schema.helpCenterArticleDailyTable.articleId, fixture.articleId)
          );

        // A flip is a second verdict cast, not a correction of the first: the
        // bucket counts judgments made, which is what "was this helpful"
        // measures. The standing distribution is the feedback table itself.
        expect(rows).toStrictEqual([{ helpful: 1, unhelpful: 1 }]);
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

    it.effect(
      "keys a signed-in verdict to the account, not the visitor id",
      () =>
        Effect.gen(function* () {
          const handlers = yield* HelpCenterArticleFeedbackRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const visitorId = visitorIdFor(fixture);

          // An anonymous vote first, then the same person signs in and votes
          // again: the account verdict is a second row because it is a different
          // identity facet, and the account one is what the reader sees.
          yield* handlers
            .SetHelpCenterArticleFeedback({
              organizationId: fixture.organizationId,
              articleId: fixture.articleId,
              helpful: false,
              reason: null,
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
  });
});
