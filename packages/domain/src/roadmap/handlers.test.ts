import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { type LegidOf, RoadmapId, SiteId, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { EntitlementPolicy } from "../entitlement/policies";
import { CurrentSession, type Session } from "../session-middleware";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { RoadmapRpcHandlersEffect } from "./handlers";
import { RoadmapPolicy } from "./policies";
import { RoadmapRepository } from "./repository";

describe("RoadmapRpcHandlers", () => {
  type Fixture = {
    membershipId: string;
    organizationId: LegidOf<"WorkspaceId">;
    roadmapId: LegidOf<"RoadmapId">;
    siteId: LegidOf<"SiteId">;
    userId: string;
  };

  const makeFixture = (
    roadmapVisibility: "PUBLIC" | "HIDDEN" = "PUBLIC",
    includeRoadmap = true
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const siteId = yield* SiteId.generate;
      const roadmapId = yield* RoadmapId.generate;
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
      yield* db.insert(schema.siteTable).values({
        id: siteId,
        name: "Test site",
        subdomain: `test-${organizationId}`,
        customDomain: null,
        changelogVisibility: "PUBLIC",
        roadmapVisibility,
        hidePoweredBy: false,
        noIndex: false,
        organizationId,
        createdAt: now,
        updatedAt: now,
      });
      if (includeRoadmap) {
        yield* db.insert(schema.roadmapTable).values({
          id: roadmapId,
          organizationId,
          name: "Public roadmap",
          slug: roadmapId,
          description: null,
          isPrimary: true,
          mode: "status",
          visibility: "public",
          filter: { version: 1, operator: "and", conditions: [] },
          createdAt: now,
          updatedAt: now,
        });
      }

      return {
        membershipId,
        organizationId,
        roadmapId,
        siteId,
        userId,
      } satisfies Fixture;
    });

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

  const roadmapCreateInput = (
    fixture: Fixture,
    id: LegidOf<"RoadmapId">,
    name: string,
    visibility: "public" | "private" = "public"
  ) => ({
    id,
    organizationId: fixture.organizationId,
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    description: null,
    isPrimary: false,
    mode: "status" as const,
    visibility,
    filter: { version: 1 as const, operator: "and" as const, conditions: [] },
  });

  const Repositories = Layer.mergeAll(
    RoadmapRepository.layer.pipe(Layer.provide(Database.PgliteDatabaseLive)),
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
  const RoadmapPolicies = RoadmapPolicy.layer.pipe(
    Layer.provide(Entitlements),
    Layer.provide(Repositories)
  );
  const TestLayer = Layer.mergeAll(
    Repositories,
    Entitlements,
    Policies,
    RoadmapPolicies,
    Database.PgliteDatabaseLive
  );

  layer(TestLayer)("handlers", (it) => {
    it.effect("lists public roadmaps when the site shows the roadmap", () =>
      Effect.gen(function* () {
        const handlers = yield* RoadmapRpcHandlersEffect;
        const fixture = yield* makeFixture("PUBLIC");
        const roadmaps = yield* handlers.RoadmapListPublic({
          organizationId: fixture.organizationId,
        });
        expect(roadmaps).toMatchObject([{ id: fixture.roadmapId }]);
      })
    );
    it.effect("hides public roadmaps when the site hides the roadmap", () =>
      Effect.gen(function* () {
        const handlers = yield* RoadmapRpcHandlersEffect;
        const fixture = yield* makeFixture("HIDDEN");
        const error = yield* Effect.flip(
          handlers.RoadmapListPublic({
            organizationId: fixture.organizationId,
          })
        );
        expect(error).toMatchObject({ _tag: "PolicyDenied" });
      })
    );
    it.effect("allows owners to create a public roadmap on free plan", () =>
      Effect.gen(function* () {
        const handlers = yield* RoadmapRpcHandlersEffect;
        const fixture = yield* makeFixture("PUBLIC");
        const roadmapId = yield* RoadmapId.generate;

        yield* handlers
          .RoadmapCreate(
            roadmapCreateInput(fixture, roadmapId, "Public roadmap")
          )
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

        const roadmaps = yield* handlers
          .RoadmapList({
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
        expect(
          roadmaps.find((roadmap) => roadmap.id === roadmapId)
        ).toMatchObject({
          name: "Public roadmap",
          visibility: "public",
        });
      })
    );
    it.effect("rejects creating a private roadmap on free plan", () =>
      Effect.gen(function* () {
        const handlers = yield* RoadmapRpcHandlersEffect;
        const fixture = yield* makeFixture("PUBLIC");
        const roadmapId = yield* RoadmapId.generate;

        const error = yield* Effect.flip(
          handlers
            .RoadmapCreate(
              roadmapCreateInput(
                fixture,
                roadmapId,
                "Private roadmap",
                "private"
              )
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
        );

        expect(error).toMatchObject({ _tag: "PolicyDenied" });
      })
    );
    it.effect("allows creating a private roadmap on a paid plan", () =>
      Effect.gen(function* () {
        const handlers = yield* RoadmapRpcHandlersEffect;
        const fixture = yield* makeFixture("PUBLIC");
        const db = yield* currentDb;
        const roadmapId = yield* RoadmapId.generate;
        const now = new Date();

        yield* db.insert(schema.productTable).values({
          id: "prod_roadmap_starter",
          name: "Starter monthly",
          isRecurring: true,
          isArchived: false,
          externalOrganizationId: "polar_org",
          visibility: "PUBLIC",
          recurringInterval: "month",
          metadata: { plan: "starter", variant: "monthly" },
        });
        yield* db.insert(schema.subscriptionTable).values({
          id: "sub_roadmap_starter",
          externalId: "sub_ext_roadmap_starter",
          organizationId: fixture.organizationId,
          amount: 4900,
          cancelAtPeriodEnd: false,
          currency: "usd",
          recurringInterval: "month",
          recurringIntervalCount: 1,
          status: "trialing",
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + 86_400_000),
          customerId: "cus_roadmap_starter",
          productId: "prod_roadmap_starter",
        });

        yield* handlers
          .RoadmapCreate(
            roadmapCreateInput(fixture, roadmapId, "Private roadmap", "private")
          )
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

        const roadmaps = yield* handlers
          .RoadmapList({
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
        expect(
          roadmaps.find((roadmap) => roadmap.id === roadmapId)
        ).toMatchObject({
          name: "Private roadmap",
          visibility: "private",
        });
      })
    );
    it.effect("rejects updating a roadmap to private on free plan", () =>
      Effect.gen(function* () {
        const handlers = yield* RoadmapRpcHandlersEffect;
        const fixture = yield* makeFixture("PUBLIC");

        const error = yield* Effect.flip(
          handlers
            .RoadmapUpdate({
              id: fixture.roadmapId,
              organizationId: fixture.organizationId,
              name: "Updated roadmap",
              slug: "updated-roadmap",
              description: null,
              isPrimary: true,
              mode: "status",
              visibility: "private",
              filter: { version: 1, operator: "and", conditions: [] },
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
        );

        expect(error).toMatchObject({ _tag: "PolicyDenied" });
      })
    );
    it.effect("allows keeping an existing private roadmap on free plan", () =>
      Effect.gen(function* () {
        const handlers = yield* RoadmapRpcHandlersEffect;
        const fixture = yield* makeFixture("PUBLIC");
        const db = yield* currentDb;
        const privateRoadmapId = yield* RoadmapId.generate;
        const now = new Date();

        yield* db.insert(schema.roadmapTable).values({
          id: privateRoadmapId,
          organizationId: fixture.organizationId,
          name: "Private roadmap",
          slug: privateRoadmapId,
          description: null,
          isPrimary: false,
          mode: "status",
          visibility: "private",
          filter: { version: 1, operator: "and", conditions: [] },
          createdAt: now,
          updatedAt: now,
        });

        yield* handlers
          .RoadmapUpdate({
            id: privateRoadmapId,
            organizationId: fixture.organizationId,
            name: "Private roadmap",
            slug: privateRoadmapId,
            description: null,
            isPrimary: false,
            mode: "status",
            visibility: "private",
            filter: { version: 1, operator: "and", conditions: [] },
          })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
      })
    );
    it.effect("marks the first created roadmap as primary", () =>
      Effect.gen(function* () {
        const handlers = yield* RoadmapRpcHandlersEffect;
        const fixture = yield* makeFixture("PUBLIC", false);
        const roadmapId = yield* RoadmapId.generate;

        yield* handlers
          .RoadmapCreate(
            roadmapCreateInput(fixture, roadmapId, "First roadmap")
          )
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

        const roadmaps = yield* handlers
          .RoadmapList({
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
        expect(
          roadmaps.find((roadmap) => roadmap.id === roadmapId)
        ).toMatchObject({
          isPrimary: true,
        });
      })
    );
    it.effect("does not mark subsequent roadmaps as primary", () =>
      Effect.gen(function* () {
        const handlers = yield* RoadmapRpcHandlersEffect;
        const fixture = yield* makeFixture("PUBLIC", false);
        const firstId = yield* RoadmapId.generate;
        const secondId = yield* RoadmapId.generate;

        yield* handlers
          .RoadmapCreate(roadmapCreateInput(fixture, firstId, "First roadmap"))
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
        yield* handlers
          .RoadmapCreate(
            roadmapCreateInput(fixture, secondId, "Second roadmap")
          )
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

        const roadmaps = yield* handlers
          .RoadmapList({
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
        expect(
          roadmaps.find((roadmap) => roadmap.id === firstId)
        ).toMatchObject({
          isPrimary: true,
        });
        expect(
          roadmaps.find((roadmap) => roadmap.id === secondId)
        ).toMatchObject({
          isPrimary: false,
        });
      })
    );
    it.effect(
      "delegates primary to another roadmap when the primary is deleted",
      () =>
        Effect.gen(function* () {
          const handlers = yield* RoadmapRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const secondId = yield* RoadmapId.generate;

          yield* handlers
            .RoadmapCreate(
              roadmapCreateInput(fixture, secondId, "Second roadmap")
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          yield* handlers
            .RoadmapDelete({
              id: fixture.roadmapId,
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const roadmaps = yield* handlers
            .RoadmapList({
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          expect(
            roadmaps.find((roadmap) => roadmap.id === secondId)
          ).toMatchObject({
            isPrimary: true,
          });
        })
    );
    it.effect("leaves no primary when the only roadmap is deleted", () =>
      Effect.gen(function* () {
        const handlers = yield* RoadmapRpcHandlersEffect;
        const fixture = yield* makeFixture("PUBLIC");

        yield* handlers
          .RoadmapDelete({
            id: fixture.roadmapId,
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

        const roadmaps = yield* handlers
          .RoadmapList({
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
        expect(roadmaps).toHaveLength(0);
      })
    );
    it.effect(
      "does not delegate primary when a non-primary roadmap is deleted",
      () =>
        Effect.gen(function* () {
          const handlers = yield* RoadmapRpcHandlersEffect;
          const fixture = yield* makeFixture("PUBLIC");
          const secondId = yield* RoadmapId.generate;

          yield* handlers
            .RoadmapCreate(
              roadmapCreateInput(fixture, secondId, "Second roadmap")
            )
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          yield* handlers
            .RoadmapDelete({
              id: secondId,
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const roadmaps = yield* handlers
            .RoadmapList({
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
          expect(
            roadmaps.find((roadmap) => roadmap.id === fixture.roadmapId)
          ).toMatchObject({
            isPrimary: true,
          });
        })
    );
  });
});
