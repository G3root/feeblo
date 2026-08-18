import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  BoardId,
  ChangelogId,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ChangelogPolicy } from "../changelog/policies";
import { ChangelogRepository } from "../changelog/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import { CurrentSession, type Session } from "../session-middleware";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { ChangelogPostRpcHandlersEffect } from "./handlers";
import { ChangelogPostRepository } from "./repository";

describe("ChangelogPostRpcHandlers", () => {
  type Fixture = {
    changelogId: string;
    membershipId: string;
    organizationId: string;
    postId: string;
    userId: string;
  };

  const makeSession = (
    fixture: Fixture,
    role: Session["memberships"][number]["role"] | null = "manager"
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
      const boardId = yield* BoardId.generate;
      const statusId = yield* PostStatusId.generate;
      const changelogId = yield* ChangelogId.generate;
      const postId = yield* PostId.generate;
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
        role: "manager",
        createdAt: now,
      });
      yield* db.insert(schema.boardTable).values({
        id: boardId,
        name: "Feedback board",
        slug: `board-${organizationId}`,
        visibility: "PUBLIC",
        organizationId,
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.postStatusTable).values({
        id: statusId,
        type: "COMPLETED",
        orderIndex: 0,
        organizationId,
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.postTable).values({
        id: postId,
        title: "Shipped improvement",
        slug: postId,
        content: "A completed post",
        excerpt: "",
        boardId,
        statusId,
        organizationId,
        source: "DASHBOARD",
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.changelogTable).values({
        id: changelogId,
        title: "Release notes",
        slug: changelogId,
        content: "Notes",
        excerpt: "",
        status: "published",
        organizationId,
        createdAt: now,
        updatedAt: now,
      });

      return {
        changelogId,
        membershipId,
        organizationId,
        postId,
        userId,
      } satisfies Fixture;
    });

  const Repositories = Layer.mergeAll(
    ChangelogPostRepository.layer.pipe(
      Layer.provide(Database.PgliteDatabaseLive)
    ),
    ChangelogRepository.layer.pipe(Layer.provide(Database.PgliteDatabaseLive)),
    SiteRepository.layer.pipe(Layer.provide(Database.PgliteDatabaseLive)),
    WorkspaceRepository.layer.pipe(Layer.provide(Database.PgliteDatabaseLive)),
    Database.PgliteDatabaseLive
  );
  const Entitlements = EntitlementPolicy.layer.pipe(
    Layer.provide(Repositories)
  );
  const Policies = SitePolicy.layer.pipe(
    Layer.provide(Entitlements),
    Layer.provide(Repositories)
  );
  const ChangelogPolicies = ChangelogPolicy.layer.pipe(
    Layer.provide(Entitlements),
    Layer.provide(Repositories)
  );
  const TestLayer = Layer.mergeAll(
    Repositories,
    Entitlements,
    Policies,
    ChangelogPolicies,
    Database.PgliteDatabaseLive
  );

  layer(TestLayer)("handlers", (it) => {
    it.effect("links a post to a changelog in the same organization", () =>
      Effect.gen(function* () {
        const handlers = yield* ChangelogPostRpcHandlersEffect;
        const fixture = yield* makeFixture();

        yield* handlers
          .ChangelogPostCreate({
            changelogId: fixture.changelogId,
            postId: fixture.postId,
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

        const posts = yield* handlers
          .ChangelogPostList({
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
        expect(posts).toMatchObject([
          {
            changelogId: fixture.changelogId,
            postId: fixture.postId,
            organizationId: fixture.organizationId,
          },
        ]);
      })
    );
    it.effect(
      "rejects linking a post to a changelog owned by another organization",
      () =>
        Effect.gen(function* () {
          const handlers = yield* ChangelogPostRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const db = yield* currentDb;
          const foreignOrganizationId = yield* WorkspaceId.generate;
          const foreignChangelogId = yield* ChangelogId.generate;
          const now = new Date();

          yield* db.insert(schema.organizationTable).values({
            id: foreignOrganizationId,
            name: "Foreign organization",
            slug: foreignOrganizationId,
            createdAt: now,
          });
          // The changelog is enumerable (public listings) but owned by a
          // different organization; linking to it must be denied.
          yield* db.insert(schema.changelogTable).values({
            id: foreignChangelogId,
            title: "Foreign release notes",
            slug: foreignChangelogId,
            content: "Notes",
            excerpt: "",
            status: "published",
            organizationId: foreignOrganizationId,
            createdAt: now,
            updatedAt: now,
          });

          const error = yield* Effect.flip(
            handlers
              .ChangelogPostCreate({
                changelogId: foreignChangelogId,
                postId: fixture.postId,
                organizationId: fixture.organizationId,
              })
              .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
          );
          expect(error).toMatchObject({ _tag: "PolicyDenied" });

          const posts = yield* handlers
            .ChangelogPostList({
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          expect(posts).toHaveLength(0);
        })
    );
  });
});
