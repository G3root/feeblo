import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { ChangelogCategoryId, SiteId, WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { EntitlementPolicy } from "../entitlement/policies";
import { CurrentSession, type Session } from "../session-middleware";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { ChangelogCategoryRpcHandlersEffect } from "./handlers";
import { ChangelogCategoryPolicy } from "./policies";
import { ChangelogCategoryRepository } from "./repository";

describe("ChangelogCategoryRpcHandlers", () => {
  type Fixture = {
    membershipId: string;
    organizationId: string;
    userId: string;
  };
  const makeSession = (
    fixture: Fixture,
    options?: { isMember?: boolean; role?: "owner" | "contributor" }
  ): Session => ({
    user: {
      id: fixture.userId,
      email: "user@example.com",
      name: "Test User",
      restrictedToOrganizationId: null,
    },
    session: { userId: fixture.userId, token: "test-token" },
    organizations: [{ id: fixture.organizationId }],
    memberships:
      options?.isMember === false
        ? []
        : [
            {
              membershipId: fixture.membershipId,
              organizationId: fixture.organizationId,
              role: options?.role ?? "owner",
            },
          ],
  });
  const makeFixture = () =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
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
        role: "owner",
        createdAt: now,
      });
      return { membershipId, organizationId, userId } satisfies Fixture;
    });
  const makeSite = (
    fixture: Fixture,
    changelogVisibility: "PUBLIC" | "HIDDEN"
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const siteId = yield* SiteId.generate;
      yield* db.insert(schema.siteTable).values({
        id: siteId,
        organizationId: fixture.organizationId,
        name: "Test site",
        subdomain: `site-${fixture.organizationId}`,
        changelogVisibility,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
  const insertCategory = (
    fixture: Fixture,
    overrides?: Partial<{ name: string; icon: string }>
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const id = yield* ChangelogCategoryId.generate;
      yield* db.insert(schema.changelogCategoryTable).values({
        id,
        organizationId: fixture.organizationId,
        name: overrides?.name ?? "New",
        iconType: "color",
        icon: overrides?.icon ?? "#22c55e",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return id;
    });
  const Repositories = Layer.mergeAll(
    ChangelogCategoryRepository.layer,
    SiteRepository.layer,
    WorkspaceRepository.layer
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));
  const Entitlements = EntitlementPolicy.layer.pipe(
    Layer.provide(Repositories)
  );
  const Policies = Layer.mergeAll(
    ChangelogCategoryPolicy.layer,
    SitePolicy.layer
  ).pipe(Layer.provide(Entitlements), Layer.provide(Repositories));
  const TestLayer = Layer.mergeAll(
    Repositories,
    Entitlements,
    Policies,
    Database.PgliteDatabaseLive
  );

  layer(TestLayer)("handlers", (it) => {
    it.effect("creates and lists categories for members", () =>
      Effect.gen(function* () {
        const handlers = yield* ChangelogCategoryRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const id = yield* ChangelogCategoryId.generate;
        yield* handlers
          .ChangelogCategoryCreate({
            id,
            organizationId: fixture.organizationId,
            name: "New",
            iconType: "color",
            icon: "#22c55e",
          })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
        const categories = yield* handlers
          .ChangelogCategoryList({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
        expect(categories).toMatchObject([
          {
            id,
            name: "New",
            iconType: "color",
            icon: "#22c55e",
            organizationId: fixture.organizationId,
          },
        ]);
      })
    );

    it.effect("updates a category", () =>
      Effect.gen(function* () {
        const handlers = yield* ChangelogCategoryRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const id = yield* insertCategory(fixture);
        yield* handlers
          .ChangelogCategoryUpdate({
            id,
            organizationId: fixture.organizationId,
            name: "Improved",
            iconType: "color",
            icon: "#3b82f6",
          })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
        const db = yield* currentDb;
        const [category] = yield* db
          .select()
          .from(schema.changelogCategoryTable)
          .where(eq(schema.changelogCategoryTable.id, id));
        expect(category).toMatchObject({
          name: "Improved",
          icon: "#3b82f6",
        });
      })
    );

    it.effect("deletes a category", () =>
      Effect.gen(function* () {
        const handlers = yield* ChangelogCategoryRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const id = yield* insertCategory(fixture);
        yield* handlers
          .ChangelogCategoryDelete({
            id,
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
        const categories = yield* handlers
          .ChangelogCategoryList({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
        expect(categories).toEqual([]);
      })
    );

    it.effect("rejects contributors from creating categories", () =>
      Effect.gen(function* () {
        const handlers = yield* ChangelogCategoryRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const id = yield* ChangelogCategoryId.generate;
        const error = yield* Effect.flip(
          handlers
            .ChangelogCategoryCreate({
              id,
              organizationId: fixture.organizationId,
              name: "New",
              iconType: "color",
              icon: "#22c55e",
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, { role: "contributor" })
              )
            )
        );
        expect(error._tag).toBe("PolicyDenied");
      })
    );

    it.effect("rejects non-members from listing categories", () =>
      Effect.gen(function* () {
        const handlers = yield* ChangelogCategoryRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const error = yield* Effect.flip(
          handlers
            .ChangelogCategoryList({ organizationId: fixture.organizationId })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, { isMember: false })
              )
            )
        );
        expect(error._tag).toBe("PolicyDenied");
      })
    );

    it.effect("serves categories publicly when changelogs are public", () =>
      Effect.gen(function* () {
        const handlers = yield* ChangelogCategoryRpcHandlersEffect;
        const fixture = yield* makeFixture();
        yield* makeSite(fixture, "PUBLIC");
        const id = yield* insertCategory(fixture);
        const categories = yield* handlers.ChangelogCategoryListPublic({
          organizationId: fixture.organizationId,
        });
        expect(categories).toMatchObject([
          {
            id,
            organizationId: fixture.organizationId,
          },
        ]);
      })
    );

    it.effect("hides categories publicly when changelogs are hidden", () =>
      Effect.gen(function* () {
        const handlers = yield* ChangelogCategoryRpcHandlersEffect;
        const fixture = yield* makeFixture();
        yield* makeSite(fixture, "HIDDEN");
        const error = yield* Effect.flip(
          handlers.ChangelogCategoryListPublic({
            organizationId: fixture.organizationId,
          })
        );
        expect(error._tag).toBe("PolicyDenied");
      })
    );

    it.effect("blocks creating a fourth category on the free plan", () =>
      Effect.gen(function* () {
        const handlers = yield* ChangelogCategoryRpcHandlersEffect;
        const fixture = yield* makeFixture();
        for (let index = 0; index < 3; index++) {
          yield* insertCategory(fixture, {
            name: `Category ${index + 1}`,
            icon: "#22c55e",
          });
        }
        const id = yield* ChangelogCategoryId.generate;
        const error = yield* Effect.flip(
          handlers
            .ChangelogCategoryCreate({
              id,
              organizationId: fixture.organizationId,
              name: "Fourth",
              iconType: "color",
              icon: "#22c55e",
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
        );
        expect(error._tag).toBe("PolicyDenied");
      })
    );
  });
});
