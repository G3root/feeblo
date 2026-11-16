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
import { CurrentSession, type Session } from "../session-middleware";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { HelpCenterTopicRpcHandlersEffect } from "./handlers";
import { HelpCenterTopicPolicy } from "./policies";
import { HelpCenterTopicRepository } from "./repository";

describe("HelpCenterTopicRpcHandlers", () => {
  type Fixture = {
    membershipId: string;
    organizationId: LegidOf<"WorkspaceId">;
    userId: string;
  };

  /** A section id is branded, so a fixture holds the brand and not a string. */
  type TopicId = LegidOf<"HelpCenterTopicId">;

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

      return { membershipId, organizationId, userId } satisfies Fixture;
    });

  /** Insert an article directly, so a section can be made non-empty cheaply. */
  const addArticle = (fixture: Fixture, topicId: TopicId) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const id = yield* HelpCenterArticleId.generate;
      const now = yield* DateTime.nowAsDate;

      yield* db.insert(schema.helpCenterArticleTable).values({
        id,
        organizationId: fixture.organizationId,
        topicId,
        slug: `article-${id}`,
        title: "Existing article",
        content: "Body",
        excerpt: "Body",
        status: "published",
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      return id;
    });

  const Repositories = Layer.mergeAll(
    HelpCenterTopicRepository.layer,
    SiteRepository.layer,
    WorkspaceRepository.layer
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));

  const Entitlements = EntitlementPolicy.layer.pipe(
    Layer.provide(Repositories)
  );

  const Policies = Layer.mergeAll(
    HelpCenterTopicPolicy.layer,
    SitePolicy.layer
  ).pipe(Layer.provide(Entitlements), Layer.provide(Repositories));

  const TestLayer = Layer.mergeAll(
    Repositories,
    Entitlements,
    Policies,
    Database.PgliteDatabaseLive
  );

  layer(TestLayer)("handlers", (it) => {
    it.effect(
      "creates a section, deriving the slug and appending the position",
      () =>
        Effect.gen(function* () {
          const handlers = yield* HelpCenterTopicRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const id = yield* HelpCenterTopicId.generate;

          yield* handlers
            .CreateHelpCenterTopic({
              id,
              organizationId: fixture.organizationId,
              name: "Getting started",
              slug: undefined,
              description: null,
              icon: null,
              position: undefined,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const topics = yield* handlers
            .ListHelpCenterTopics({ organizationId: fixture.organizationId })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(topics).toHaveLength(1);
          // Derived from the name, not left empty: the slug is part of a public
          // URL and the dashboard does not ask for one.
          expect(topics[0]?.slug).toBe("getting-started");
          expect(topics[0]?.position).toBe(0);
          expect(topics[0]?.articleCount).toBe(0);
        })
    );

    it.effect("appends each new section after the last", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterTopicRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const session = makeSession(fixture);

        for (const name of ["First", "Second"]) {
          yield* handlers
            .CreateHelpCenterTopic({
              id: yield* HelpCenterTopicId.generate,
              organizationId: fixture.organizationId,
              name,
              slug: undefined,
              description: null,
              icon: null,
              position: undefined,
            })
            .pipe(Effect.provideService(CurrentSession, session));
        }

        const topics = yield* handlers
          .ListHelpCenterTopics({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, session));

        expect(topics.map((topic) => [topic.name, topic.position])).toEqual([
          ["First", 0],
          ["Second", 1],
        ]);
      })
    );

    it.effect("refuses a slug another section already holds", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterTopicRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const session = makeSession(fixture);

        const create = (id: TopicId, name: string, slug: string) =>
          handlers
            .CreateHelpCenterTopic({
              id,
              organizationId: fixture.organizationId,
              name,
              slug,
              description: null,
              icon: null,
              position: undefined,
            })
            .pipe(Effect.provideService(CurrentSession, session));

        yield* create(yield* HelpCenterTopicId.generate, "First", "shared");

        const error = yield* Effect.flip(
          create(yield* HelpCenterTopicId.generate, "Second", "shared")
        );

        // A collision is a routine editing outcome, so it carries the slug
        // rather than surfacing as a 500.
        expect(error._tag).toBe("HelpCenterTopicSlugTakenError");
      }).pipe(Effect.orDie)
    );

    it.effect("refuses to delete a section that still holds articles", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterTopicRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const session = makeSession(fixture);
        const topicId = yield* HelpCenterTopicId.generate;

        yield* handlers
          .CreateHelpCenterTopic({
            id: topicId,
            organizationId: fixture.organizationId,
            name: "Billing",
            slug: undefined,
            description: null,
            icon: null,
            position: undefined,
          })
          .pipe(Effect.provideService(CurrentSession, session));
        yield* addArticle(fixture, topicId);

        const error = yield* Effect.flip(
          handlers
            .DeleteHelpCenterTopic({
              id: topicId,
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, session))
        );

        // The database refuses with `ON DELETE RESTRICT`; the handler
        // translates that into the count an editor needs to act on, instead of
        // letting a foreign-key violation surface as a server fault.
        expect(error._tag).toBe("HelpCenterTopicNotEmptyError");
        expect(error).toMatchObject({ articleCount: 1 });

        const topics = yield* handlers
          .ListHelpCenterTopics({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, session));

        expect(topics).toHaveLength(1);
      })
    );

    it.effect("deletes an empty section", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterTopicRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const session = makeSession(fixture);
        const topicId = yield* HelpCenterTopicId.generate;

        yield* handlers
          .CreateHelpCenterTopic({
            id: topicId,
            organizationId: fixture.organizationId,
            name: "Empty",
            slug: undefined,
            description: null,
            icon: null,
            position: undefined,
          })
          .pipe(Effect.provideService(CurrentSession, session));

        yield* handlers
          .DeleteHelpCenterTopic({
            id: topicId,
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, session));

        const topics = yield* handlers
          .ListHelpCenterTopics({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, session));

        expect(topics).toHaveLength(0);
      })
    );

    it.effect("applies a reorder in one write", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterTopicRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const session = makeSession(fixture);

        const ids: TopicId[] = [];

        for (const name of ["First", "Second", "Third"]) {
          const id = yield* HelpCenterTopicId.generate;
          ids.push(id);
          yield* handlers
            .CreateHelpCenterTopic({
              id,
              organizationId: fixture.organizationId,
              name,
              slug: undefined,
              description: null,
              icon: null,
              position: undefined,
            })
            .pipe(Effect.provideService(CurrentSession, session));
        }

        const reversed = ids.toReversed();
        yield* handlers
          .ReorderHelpCenterTopics({
            organizationId: fixture.organizationId,
            topicIds: reversed.map((id) => id),
          })
          .pipe(Effect.provideService(CurrentSession, session));

        const topics = yield* handlers
          .ListHelpCenterTopics({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, session));

        expect(topics.map((topic) => topic.name)).toEqual([
          "Third",
          "Second",
          "First",
        ]);
      })
    );

    it.effect("refuses a reorder that does not name every section", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterTopicRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const session = makeSession(fixture);
        const id = yield* HelpCenterTopicId.generate;

        yield* handlers
          .CreateHelpCenterTopic({
            id,
            organizationId: fixture.organizationId,
            name: "Only",
            slug: undefined,
            description: null,
            icon: null,
            position: undefined,
          })
          .pipe(Effect.provideService(CurrentSession, session));

        const other = yield* HelpCenterTopicId.generate;

        const error = yield* Effect.flip(
          handlers
            .ReorderHelpCenterTopics({
              organizationId: fixture.organizationId,
              // A partial list applied as "these first" would leave the
              // unnamed sections at positions that now collide.
              topicIds: [other],
            })
            .pipe(Effect.provideService(CurrentSession, session))
        );

        expect(error._tag).toBe("BadRequestError");
      })
    );

    it.effect("rejects a caller without a membership", () =>
      Effect.gen(function* () {
        const handlers = yield* HelpCenterTopicRpcHandlersEffect;
        const fixture = yield* makeFixture();

        const error = yield* Effect.flip(
          handlers
            .ListHelpCenterTopics({ organizationId: fixture.organizationId })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture, false))
            )
        );

        expect(error._tag).toBe("PolicyDenied");
      })
    );

    it.effect(
      "does not list a section with no published article publicly",
      () =>
        Effect.gen(function* () {
          const handlers = yield* HelpCenterTopicRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const session = makeSession(fixture);
          const withDraft = yield* HelpCenterTopicId.generate;
          const withPublished = yield* HelpCenterTopicId.generate;

          for (const [id, name] of [
            [withDraft, "Drafts only"],
            [withPublished, "Published"],
          ] as const) {
            yield* handlers
              .CreateHelpCenterTopic({
                id,
                organizationId: fixture.organizationId,
                name,
                slug: undefined,
                description: null,
                icon: null,
                position: undefined,
              })
              .pipe(Effect.provideService(CurrentSession, session));
          }

          yield* addArticle(fixture, withPublished);

          const topics = yield* handlers.ListHelpCenterTopicsPublic({
            organizationId: fixture.organizationId,
          });

          // A section holding only drafts names unreleased documentation, so the
          // portal must not reveal that it exists.
          expect(topics.map((topic) => topic.name)).toStrictEqual([
            "Published",
          ]);
        })
    );
  });
});
