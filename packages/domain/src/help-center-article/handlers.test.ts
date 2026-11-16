import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  HelpCenterArticleId,
  HelpCenterTopicId,
  type LegidOf,
  SiteId,
  WorkspaceId,
} from "@feeblo/id";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EntitlementPolicy } from "../entitlement/policies";
import { HelpCenterTopicRepository } from "../help-center-topic/repository";
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

  const TestLayer = Layer.mergeAll(
    Repositories,
    Entitlements,
    Policies,
    Database.PgliteDatabaseLive
  );

  /**
   * A beacon id, distinct per test.
   *
   * `crypto.randomUUID()` is what the browser sends, but an Effect test reads
   * randomness through a service, so the fixtures name their ids instead. They
   * must differ between tests: the event's primary key is the id alone, and a
   * shared one would be deduplicated away as a retry.
   */
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
  });
});
