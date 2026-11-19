import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { DEFAULT_POST_EMBEDDING_DIMENSIONS } from "@feeblo/db";
import {
  HelpCenterArticleId,
  HelpCenterTopicId,
  type LegidOf,
  SiteId,
  WorkspaceId,
} from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { TestClock } from "effect/testing";

import { EntitlementPolicy } from "../entitlement/policies";
import { HelpCenterTopicRepository } from "../help-center-topic/repository";
import { HelpCenterEnabled } from "../help-center/flag";
import { PostEmbeddingService } from "../post/embedding-service";
import { CurrentSession, type Session } from "../session-middleware";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { HelpCenterArticleRpcHandlersEffect } from "./handlers";
import { HelpCenterArticlePolicy } from "./policies";
import { HelpCenterArticleRepository } from "./repository";

describe("HelpCenterArticleRpcHandlers", () => {
  type Fixture = {
    membershipId: string;
    organizationId: LegidOf<"WorkspaceId">;
    topicId: LegidOf<"HelpCenterTopicId">;
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

  const makeFixture = () =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const siteId = yield* SiteId.generate;
      const topicId = yield* HelpCenterTopicId.generate;
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

      return {
        membershipId,
        organizationId,
        topicId,
        userId,
      } satisfies Fixture;
    });

  /** Insert `count` articles directly, so a plan ceiling is reached cheaply. */
  const seedArticles = (fixture: Fixture, count: number) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const now = yield* DateTime.nowAsDate;

      for (let index = 0; index < count; index++) {
        yield* db.insert(schema.helpCenterArticleTable).values({
          id: `seed_article_${fixture.organizationId}_${index}`,
          organizationId: fixture.organizationId,
          topicId: fixture.topicId,
          slug: `seed-${index}`,
          title: `Seed ${index}`,
          content: "Body",
          excerpt: "Body",
          status: "published",
          publishedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

  const Repositories = Layer.mergeAll(
    HelpCenterArticleRepository.layer,
    HelpCenterTopicRepository.layer,
    SiteRepository.layer,
    WorkspaceRepository.layer
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));

  const Entitlements = EntitlementPolicy.layer.pipe(
    Layer.provide(Repositories)
  );

  const Policies = Layer.mergeAll(
    HelpCenterArticlePolicy.layer,
    SitePolicy.layer
  ).pipe(Layer.provide(Entitlements), Layer.provide(Repositories));

  // The flag is on for these suites: they exercise the feature, and a separate
  // case below proves the gate refuses when it is off.
  const TestLayer = Layer.mergeAll(
    Repositories,
    Entitlements,
    Policies,
    Database.PgliteDatabaseLive,
    Layer.succeed(HelpCenterEnabled, true)
  );

  /**
   * A beacon id, distinct per test.
   *
   * `crypto.randomUUID()` is what the browser sends, but an Effect test reads
   * randomness through a service, so the fixtures name their ids instead. They
   * must differ between tests: the event's primary key is the id alone, and a
   * shared one would be deduplicated away as a retry.
   */
  /**
   * A unit vector with a single non-zero component.
   *
   * Cosine distance between two of them is 0 when the components match and 1
   * when they differ, which is the whole range a test needs and cheaper to
   * reason about than a random vector.
   */
  const unitVector = (component: number) =>
    Array.from({ length: DEFAULT_POST_EMBEDDING_DIMENSIONS }, (_, index) =>
      index === component ? 1 : 0
    );

  /** An embedder that answers one fixed model and vector. */
  const fixedEmbedder = (vector: readonly number[]) => ({
    embed: () =>
      Effect.succeedSome({ model: "test-embedding", vector: [...vector] }),
  });

  const beaconId = (seed: number) =>
    `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;

  const create = (
    fixture: Fixture,
    id: LegidOf<"HelpCenterArticleId">,
    title: string,
    slug?: string
  ) =>
    Effect.gen(function* () {
      const handlers = yield* HelpCenterArticleRpcHandlersEffect;

      return yield* handlers
        .CreateHelpCenterArticle({
          id,
          organizationId: fixture.organizationId,
          topicId: fixture.topicId,
          title,
          slug,
          content: "# Hello\n\nSome **body**.",
          status: "published",
          publishedAt: null,
          position: null,
        })
        .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
    });

  layer(TestLayer)("handlers", (it) => {
    it.effect("publishes an article, deriving slug, excerpt and date", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const id = yield* HelpCenterArticleId.generate;

        yield* create(fixture, id, "  How do I reset my password?  ");

        const article = yield* handlers
          .GetHelpCenterArticle({ organizationId: fixture.organizationId, id })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

        expect(article.slug).toBe("how-do-i-reset-my-password");
        expect(article.title).toBe("How do I reset my password?");
        expect(article.status).toBe("published");
        // A published article always carries its date; the column's own check
        // would refuse the row otherwise.
        expect(article.publishedAt).not.toBeNull();
        expect(article.excerpt.length).toBeGreaterThan(0);
        expect(article.viewCount).toBe(0);
        expect(article.helpfulCount).toBe(0);
      })
    );

    it.effect("refuses a slug another article already holds", () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* create(
          fixture,
          yield* HelpCenterArticleId.generate,
          "First",
          "shared"
        );

        const error = yield* Effect.flip(
          create(
            fixture,
            yield* HelpCenterArticleId.generate,
            "Second",
            "shared"
          )
        );

        expect(error._tag).toBe("HelpCenterArticleSlugTakenError");
      })
    );

    it.effect("refuses a create naming another workspace's section", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleRpcHandlersEffect;
        const fixture = yield* makeFixture();

        const error = yield* Effect.flip(
          handlers
            .CreateHelpCenterArticle({
              id: yield* HelpCenterArticleId.generate,
              organizationId: fixture.organizationId,
              // A section id from nowhere: the composite foreign key would
              // refuse the row with a 23503, which is not something an editor
              // can act on, so the policy names the real problem first.
              topicId: yield* HelpCenterTopicId.generate,
              title: "Orphan",
              slug: undefined,
              content: "Body",
              status: "draft",
              publishedAt: null,
              position: null,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
        );

        expect(error._tag).toBe("PolicyDenied");
      })
    );

    it.effect("stops at the free plan's 25-article ceiling", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleRpcHandlersEffect;
        const fixture = yield* makeFixture();

        yield* seedArticles(fixture, 25);

        const error = yield* Effect.flip(
          handlers
            .CreateHelpCenterArticle({
              id: yield* HelpCenterArticleId.generate,
              organizationId: fixture.organizationId,
              topicId: fixture.topicId,
              title: "The 26th",
              slug: undefined,
              content: "Body",
              status: "draft",
              publishedAt: null,
              position: null,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
        );

        expect(error._tag).toBe("PolicyDenied");
        expect(error).toMatchObject({
          reason: expect.stringContaining("25"),
        });
      })
    );

    it.effect("keeps the original publication date on a republish", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const session = makeSession(fixture);
        const id = yield* HelpCenterArticleId.generate;

        yield* create(fixture, id, "Stable date", "stable-date");

        const before = yield* handlers
          .GetHelpCenterArticle({ organizationId: fixture.organizationId, id })
          .pipe(Effect.provideService(CurrentSession, session));

        yield* handlers
          .UpdateHelpCenterArticle({
            id,
            organizationId: fixture.organizationId,
            topicId: fixture.topicId,
            title: "Stable date",
            slug: "stable-date",
            content: "A typo fix.",
            status: "published",
            // No date supplied: the stored one wins, so a typo fix does not
            // look like a new release to a reader sorting by date.
            publishedAt: null,
            position: null,
          })
          .pipe(Effect.provideService(CurrentSession, session));

        const after = yield* handlers
          .GetHelpCenterArticle({ organizationId: fixture.organizationId, id })
          .pipe(Effect.provideService(CurrentSession, session));

        expect(after.publishedAt).toStrictEqual(before.publishedAt);
      })
    );

    it.effect(
      "clears the publication date when an article returns to draft",
      () =>
        Effect.gen(function* () {
          const handlers = yield* HelpCenterArticleRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const session = makeSession(fixture);
          const id = yield* HelpCenterArticleId.generate;

          yield* create(fixture, id, "Goes back", "goes-back");

          yield* handlers
            .UpdateHelpCenterArticle({
              id,
              organizationId: fixture.organizationId,
              topicId: fixture.topicId,
              title: "Goes back",
              slug: "goes-back",
              content: "Body",
              status: "draft",
              publishedAt: null,
              position: null,
            })
            .pipe(Effect.provideService(CurrentSession, session));

          const article = yield* handlers
            .GetHelpCenterArticle({
              organizationId: fixture.organizationId,
              id,
            })
            .pipe(Effect.provideService(CurrentSession, session));

          expect(article.status).toBe("draft");
          expect(article.publishedAt).toBeNull();
        })
    );

    it.effect(
      "hides a draft from the portal and serves an archived article",
      () =>
        Effect.gen(function* () {
          const handlers = yield* HelpCenterArticleRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const session = makeSession(fixture);
          const draft = yield* HelpCenterArticleId.generate;
          const archived = yield* HelpCenterArticleId.generate;

          yield* handlers
            .CreateHelpCenterArticle({
              id: draft,
              organizationId: fixture.organizationId,
              topicId: fixture.topicId,
              title: "Still a draft",
              slug: "still-a-draft",
              content: "Body",
              status: "draft",
              publishedAt: null,
              position: null,
            })
            .pipe(Effect.provideService(CurrentSession, session));

          yield* create(fixture, archived, "Withdrawn", "withdrawn");
          yield* handlers
            .UpdateHelpCenterArticle({
              id: archived,
              organizationId: fixture.organizationId,
              topicId: fixture.topicId,
              title: "Withdrawn",
              slug: "withdrawn",
              content: "Body",
              status: "archived",
              publishedAt: null,
              position: null,
            })
            .pipe(Effect.provideService(CurrentSession, session));

          const draftError = yield* Effect.flip(
            handlers.GetHelpCenterArticlePublic({
              organizationId: fixture.organizationId,
              slug: "still-a-draft",
            })
          );

          expect(draftError._tag).toBe("NotFoundError");

          const withdrawn = yield* handlers.GetHelpCenterArticlePublic({
            organizationId: fixture.organizationId,
            slug: "withdrawn",
          });

          // A withdrawn article still resolves: its inbound links are in
          // customers' tickets, and the page says it is out of date.
          expect(withdrawn.isArchived).toBe(true);

          const list = yield* handlers.ListHelpCenterArticlesPublic({
            organizationId: fixture.organizationId,
          });

          expect(list.map((article) => article.slug)).toStrictEqual([
            "withdrawn",
          ]);
        })
    );

    it.effect("counts a view once per beacon id", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const session = makeSession(fixture);
        const id = yield* HelpCenterArticleId.generate;

        yield* create(fixture, id, "Counted", "counted");

        const viewId = beaconId(1);

        const first = yield* handlers.AddHelpCenterArticleView({
          organizationId: fixture.organizationId,
          articleId: id,
          id: viewId,
        });

        const second = yield* handlers.AddHelpCenterArticleView({
          organizationId: fixture.organizationId,
          articleId: id,
          id: viewId,
        });

        expect(first.accepted).toBe(true);
        // A retried beacon is not a second read: the event insert gates the
        // counter increment.
        expect(second.accepted).toBe(true);

        const article = yield* handlers
          .GetHelpCenterArticle({ organizationId: fixture.organizationId, id })
          .pipe(Effect.provideService(CurrentSession, session));

        expect(article.viewCount).toBe(1);
      })
    );

    it.effect("accepts but discards a view of a draft", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const session = makeSession(fixture);
        const id = yield* HelpCenterArticleId.generate;

        yield* handlers
          .CreateHelpCenterArticle({
            id,
            organizationId: fixture.organizationId,
            topicId: fixture.topicId,
            title: "Draft only",
            slug: "draft-only",
            content: "Body",
            status: "draft",
            publishedAt: null,
            position: null,
          })
          .pipe(Effect.provideService(CurrentSession, session));

        const result = yield* handlers.AddHelpCenterArticleView({
          organizationId: fixture.organizationId,
          articleId: id,
          id: beaconId(2),
        });

        // The same answer whether it stored or discarded, so the endpoint
        // cannot be used to probe for drafts.
        expect(result.accepted).toBe(false);

        const article = yield* handlers
          .GetHelpCenterArticle({ organizationId: fixture.organizationId, id })
          .pipe(Effect.provideService(CurrentSession, session));

        expect(article.viewCount).toBe(0);
      })
    );

    it.effect("searches the live documentation and not the drafts", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleRpcHandlersEffect;
        const fixture = yield* makeFixture();

        yield* create(
          fixture,
          yield* HelpCenterArticleId.generate,
          "Exporting your board",
          "exporting-your-board"
        );

        yield* handlers
          .CreateHelpCenterArticle({
            id: yield* HelpCenterArticleId.generate,
            organizationId: fixture.organizationId,
            topicId: fixture.topicId,
            title: "Exporting a draft",
            slug: "exporting-a-draft",
            content: "Not published yet",
            status: "draft",
            publishedAt: null,
            position: null,
          })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

        const publicHits = yield* handlers.SearchHelpCenterArticlesPublic({
          organizationId: fixture.organizationId,
          query: "export",
        });

        expect(publicHits.map((hit) => hit.slug)).toStrictEqual([
          "exporting-your-board",
        ]);

        // The dashboard is looking for the thing it is writing, so it sees the
        // draft the public search has to hide.
        const dashboardHits = yield* handlers
          .SearchHelpCenterArticles({
            organizationId: fixture.organizationId,
            query: "export",
          })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

        expect(
          dashboardHits
            .map((hit) => hit.slug)
            .sort((left, right) => left.localeCompare(right))
        ).toStrictEqual(["exporting-a-draft", "exporting-your-board"]);
      })
    );

    it.effect("counts each public search, and whether it found anything", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleRpcHandlersEffect;
        const db = yield* currentDb;
        const fixture = yield* makeFixture();

        yield* create(
          fixture,
          yield* HelpCenterArticleId.generate,
          "Resetting your password",
          "resetting-your-password"
        );

        yield* handlers.SearchHelpCenterArticlesPublic({
          organizationId: fixture.organizationId,
          query: "Password",
        });

        yield* handlers.SearchHelpCenterArticlesPublic({
          organizationId: fixture.organizationId,
          query: "password",
        });

        yield* handlers.SearchHelpCenterArticlesPublic({
          organizationId: fixture.organizationId,
          query: "invoicing",
        });

        // Punctuation is not a search: there is no term a full-text index
        // could match, so counting it would put noise in the gaps list.
        yield* handlers.SearchHelpCenterArticlesPublic({
          organizationId: fixture.organizationId,
          query: "!!!",
        });

        const rows = yield* (
          db
            .select({
              query: schema.helpCenterSearchDailyTable.query,
              searches: schema.helpCenterSearchDailyTable.searches,
              emptySearches: schema.helpCenterSearchDailyTable.emptySearches,
            })
            .from(schema.helpCenterSearchDailyTable)
            // The file shares one database, and the search tests above wrote
            // their own rows: the read has to be scoped to this workspace, which
            // is the same filter the analytics handler applies.
            .where(
              eq(
                schema.helpCenterSearchDailyTable.organizationId,
                fixture.organizationId
              )
            )
            .orderBy(schema.helpCenterSearchDailyTable.query)
        );

        // Case is not a different search, and the miss is recorded as a miss.
        expect(rows).toStrictEqual([
          { emptySearches: 1, query: "invoicing", searches: 1 },
          { emptySearches: 0, query: "password", searches: 2 },
        ]);
      })
    );

    it.effect("counts a window of N days as N dates ending today", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleRpcHandlersEffect;
        const db = yield* currentDb;
        const fixture = yield* makeFixture();
        const session = makeSession(fixture);
        const id = yield* HelpCenterArticleId.generate;

        yield* create(fixture, id, "Windowed article", "windowed-article");

        // Pin the clock: the handler reads "now" through `Clock`, and the
        // assertion is about which days that puts inside the window.
        yield* TestClock.setTime(
          DateTime.toEpochMillis(
            DateTime.makeUnsafe("2026-03-10T12:00:00.000Z")
          )
        );

        yield* db.insert(schema.helpCenterArticleDailyTable).values([
          // Seven days back is outside a window that starts six days back.
          {
            articleId: id,
            day: "2026-03-03",
            organizationId: fixture.organizationId,
            views: 1,
          },
          // The window's first day, inclusive.
          {
            articleId: id,
            day: "2026-03-04",
            organizationId: fixture.organizationId,
            views: 2,
          },
          {
            articleId: id,
            day: "2026-03-10",
            organizationId: fixture.organizationId,
            views: 4,
          },
        ]);

        const analytics = yield* handlers
          .GetHelpCenterAnalytics({
            organizationId: fixture.organizationId,
            range: "7d",
          })
          .pipe(Effect.provideService(CurrentSession, session));

        // 10 March minus six days: the first of seven dates, today included.
        expect(analytics.since).toBe("2026-03-04");
        expect(analytics.totals.views).toBe(6);
        expect(analytics.articles[0]?.views).toBe(6);
      })
    );

    it.effect("reports views and searches over the chosen window", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const session = makeSession(fixture);
        const id = yield* HelpCenterArticleId.generate;

        yield* create(fixture, id, "Getting started with boards", "boards");

        yield* handlers.AddHelpCenterArticleView({
          organizationId: fixture.organizationId,
          articleId: id,
          id: beaconId(11),
        });

        yield* handlers.AddHelpCenterArticleView({
          organizationId: fixture.organizationId,
          articleId: id,
          id: beaconId(12),
        });

        yield* handlers.SearchHelpCenterArticlesPublic({
          organizationId: fixture.organizationId,
          query: "boards",
        });

        const analytics = yield* handlers
          .GetHelpCenterAnalytics({
            organizationId: fixture.organizationId,
            range: "30d",
          })
          .pipe(Effect.provideService(CurrentSession, session));

        expect(analytics.range).toBe("30d");
        expect(analytics.totals.views).toBe(2);
        expect(analytics.articles).toHaveLength(1);
        expect(analytics.articles[0]?.id).toBe(id);
        expect(analytics.articles[0]?.views).toBe(2);
        expect(analytics.queries).toStrictEqual([
          { emptySearches: 0, query: "boards", searches: 1 },
        ]);
        // A search that found something is not a documentation gap.
        expect(analytics.emptyQueries).toStrictEqual([]);
      })
    );

    it.effect("refuses every operation while the flag is off", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterArticleRpcHandlersEffect;
        const fixture = yield* makeFixture();

        const error = yield* Effect.flip(
          handlers
            .ListHelpCenterArticles({ organizationId: fixture.organizationId })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture)),
              Effect.provideService(HelpCenterEnabled, false)
            )
        );

        expect(error._tag).toBe("PolicyDenied");
      })
    );
  });

  describe("embeddings", () => {
    /**
     * Reads what the write path left behind, without waiting for the detached
     * job: every assertion here is about what the request did *before* it
     * returned.
     */
    const readEmbeddingState = (id: string) =>
      Effect.gen(function* () {
        const db = yield* currentDb;

        const [row] = yield* db
          .select({
            embeddedAt: schema.helpCenterArticleTable.embeddedAt,
            embedding: schema.helpCenterArticleTable.embedding,
            embeddingModel: schema.helpCenterArticleTable.embeddingModel,
          })
          .from(schema.helpCenterArticleTable)
          .where(eq(schema.helpCenterArticleTable.id, id));

        return row;
      });

    const readContent = (id: string) =>
      Effect.gen(function* () {
        const db = yield* currentDb;

        const [row] = yield* db
          .select({
            content: schema.helpCenterArticleTable.content,
            title: schema.helpCenterArticleTable.title,
          })
          .from(schema.helpCenterArticleTable)
          .where(eq(schema.helpCenterArticleTable.id, id));

        return row;
      });

    layer(TestLayer)("handlers", (it) => {
      it.effect("asks for an embedding without making the write wait", () =>
        Effect.gen(function* () {
          const fixture = yield* makeFixture();
          const id = yield* HelpCenterArticleId.generate;
          const release = yield* Deferred.make<void>();
          let calls = 0;

          const embedder: PostEmbeddingService["Service"] = {
            embed: () =>
              Effect.sync(() => {
                calls += 1;
              }).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.as(Option.none())
              ),
          };

          // The handlers read their embedder when they are built, which is why
          // the substitute wraps the construction rather than the call.
          const handlers = yield* HelpCenterArticleRpcHandlersEffect.pipe(
            Effect.provideService(PostEmbeddingService, embedder)
          );

          yield* handlers
            .CreateHelpCenterArticle({
              id,
              organizationId: fixture.organizationId,
              topicId: fixture.topicId,
              title: "Embedded article",
              slug: "embedded-article",
              content: "Body",
              status: "published",
              publishedAt: null,
              position: null,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          yield* Effect.yieldNow;

          const state = yield* readEmbeddingState(id);

          expect(calls).toBe(1);
          // The job is still blocked on the deferred, so an embedding here
          // would mean the write awaited it.
          expect(state?.embedding).toBeNull();
          expect(state?.embeddingModel).toBeNull();
          expect(state?.embeddedAt).toBeNull();

          yield* Deferred.succeed(release, undefined);
        })
      );

      it.effect("does not spend an embedding on a draft", () =>
        Effect.gen(function* () {
          const fixture = yield* makeFixture();
          const id = yield* HelpCenterArticleId.generate;
          let calls = 0;

          const handlers = yield* HelpCenterArticleRpcHandlersEffect.pipe(
            Effect.provideService(PostEmbeddingService, {
              embed: () =>
                Effect.sync(() => {
                  calls += 1;
                }).pipe(Effect.as(Option.none())),
            })
          );

          yield* handlers
            .CreateHelpCenterArticle({
              id,
              organizationId: fixture.organizationId,
              topicId: fixture.topicId,
              title: "Unpublished",
              slug: "unpublished",
              content: "Body",
              status: "draft",
              publishedAt: null,
              position: null,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          yield* Effect.yieldNow;

          // A page no search may return is not worth a model call; the
          // publication that makes it readable schedules its own job.
          expect(calls).toBe(0);
        })
      );

      it.effect("stores a vector only for the revision it describes", () =>
        Effect.gen(function* () {
          const repository = yield* HelpCenterArticleRepository;
          const fixture = yield* makeFixture();
          const id = yield* HelpCenterArticleId.generate;
          const now = yield* DateTime.nowAsDate;
          const vector = unitVector(0);

          yield* create(fixture, id, "Original title", "original-title");

          const current = yield* readContent(id);

          if (current === undefined) {
            return yield* Effect.die(new Error("fixture article missing"));
          }

          const stale = yield* repository.saveEmbedding({
            articleId: id,
            content: current.content,
            model: "test-embedding",
            now,
            organizationId: fixture.organizationId,
            title: "A title the editor has since replaced",
            vector,
          });

          // The job runs after the write, and an editor who saved again in
          // that window must not end up with a vector for the old text.
          expect(stale).toBe(false);

          const afterStale = yield* readEmbeddingState(id);

          expect(afterStale?.embedding).toBeNull();

          const stored = yield* repository.saveEmbedding({
            articleId: id,
            content: current.content,
            model: "test-embedding",
            now,
            organizationId: fixture.organizationId,
            title: current.title,
            vector,
          });

          expect(stored).toBe(true);

          const state = yield* readEmbeddingState(id);

          expect(state?.embeddingModel).toBe("test-embedding");
          expect(state?.embeddedAt).not.toBeNull();
        })
      );

      it.effect("clears the vector when the text changes, and only then", () =>
        Effect.gen(function* () {
          const repository = yield* HelpCenterArticleRepository;
          const handlers = yield* HelpCenterArticleRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const session = makeSession(fixture);
          const id = yield* HelpCenterArticleId.generate;
          const now = yield* DateTime.nowAsDate;

          yield* create(fixture, id, "Original title", "original-title");

          const current = yield* readContent(id);

          if (current === undefined) {
            return yield* Effect.die(new Error("fixture article missing"));
          }

          yield* repository.saveEmbedding({
            articleId: id,
            content: current.content,
            model: "test-embedding",
            now,
            organizationId: fixture.organizationId,
            title: current.title,
            vector: unitVector(0),
          });

          // A reorder is not a text change: the vector still describes the
          // words on the page, so it is kept.
          yield* handlers
            .UpdateHelpCenterArticle({
              content: current.content,
              expectedStatus: "published",
              id,
              organizationId: fixture.organizationId,
              position: 5,
              publishedAt: null,
              slug: "original-title",
              status: "published",
              title: current.title,
              topicId: fixture.topicId,
            })
            .pipe(Effect.provideService(CurrentSession, session));

          const afterMove = yield* readEmbeddingState(id);

          expect(afterMove?.embedding).not.toBeNull();

          yield* handlers
            .UpdateHelpCenterArticle({
              content: `${current.content}\n\nOne more line.`,
              expectedStatus: "published",
              id,
              organizationId: fixture.organizationId,
              position: 5,
              publishedAt: null,
              slug: "original-title",
              status: "published",
              title: current.title,
              topicId: fixture.topicId,
            })
            .pipe(Effect.provideService(CurrentSession, session));

          const afterEdit = yield* readEmbeddingState(id);

          // Keeping it would let a search match words the article no longer
          // has, until the detached refresh lands.
          expect(afterEdit?.embedding).toBeNull();
        })
      );

      it.effect(
        "answers from the semantic pass when the words match nothing",
        () =>
          Effect.gen(function* () {
            const repository = yield* HelpCenterArticleRepository;
            const fixture = yield* makeFixture();
            const now = yield* DateTime.nowAsDate;

            const nearId = yield* HelpCenterArticleId.generate;
            const farId = yield* HelpCenterArticleId.generate;
            const bareId = yield* HelpCenterArticleId.generate;

            yield* create(
              fixture,
              nearId,
              "Reports are empty",
              "empty-reports"
            );
            yield* create(
              fixture,
              farId,
              "Change your plan",
              "change-your-plan"
            );
            yield* create(fixture, bareId, "Export a board", "export-a-board");

            const embed = (id: string, component: number) =>
              Effect.gen(function* () {
                const row = yield* readContent(id);

                if (row === undefined) {
                  return yield* Effect.die(
                    new Error("fixture article missing")
                  );
                }

                yield* repository.saveEmbedding({
                  articleId: id,
                  content: row.content,
                  model: "test-embedding",
                  now,
                  organizationId: fixture.organizationId,
                  title: row.title,
                  vector: unitVector(component),
                });
              });

            // The near article sits at distance 0 from the query vector, the far
            // one at 1, and `bareId` carries no vector at all.
            yield* embed(nearId, 3);
            yield* embed(farId, 9);

            const searching = yield* HelpCenterArticleRpcHandlersEffect.pipe(
              Effect.provideService(
                PostEmbeddingService,
                fixedEmbedder(unitVector(3))
              )
            );

            const hits = yield* searching.SearchHelpCenterArticlesPublic({
              organizationId: fixture.organizationId,
              query: "why is this page blank",
            });

            // No word is shared with the near article's title, so this answer can
            // only have come from the vector. The far article is beyond the
            // threshold and the unembedded one is not a candidate.
            expect(hits.map((hit) => hit.id)).toStrictEqual([nearId]);
          })
      );
    });
  });
});
