import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  PostStatusId,
  RoadmapColumnId,
  RoadmapId,
  SiteId,
  WorkspaceId,
} from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EntitlementPolicy } from "../entitlement/policies";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { RoadmapColumnRpcHandlersEffect } from "./handlers";
import { RoadmapColumnRepository } from "./repository";

describe("RoadmapColumnRpcHandlers", () => {
  type Fixture = {
    columnId: string;
    membershipId: string;
    organizationId: string;
    roadmapId: string;
    siteId: string;
    userId: string;
  };

  const makeFixture = (roadmapVisibility: "PUBLIC" | "HIDDEN") =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const siteId = yield* SiteId.generate;
      const roadmapId = yield* RoadmapId.generate;
      const columnId = yield* RoadmapColumnId.generate;
      const statusId = yield* PostStatusId.generate;
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
      yield* db.insert(schema.postStatusTable).values({
        id: statusId,
        type: "PENDING",
        orderIndex: 0,
        organizationId,
      });
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
      yield* db.insert(schema.roadmapColumnTable).values({
        id: columnId,
        roadmapId,
        name: "Column",
        position: 0,
        config: { type: "status", statusId },
        createdAt: now,
        updatedAt: now,
      });

      return {
        columnId,
        membershipId,
        organizationId,
        roadmapId,
        siteId,
        userId,
      } satisfies Fixture;
    });

  const Repositories = Layer.mergeAll(
    RoadmapColumnRepository.layer.pipe(
      Layer.provide(Database.PgliteDatabaseLive)
    ),
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
  const TestLayer = Layer.mergeAll(
    Repositories,
    Entitlements,
    Policies,
    Database.PgliteDatabaseLive
  );

  layer(TestLayer)("handlers", (it) => {
    it.effect("lists public columns when the site shows the roadmap", () =>
      Effect.gen(function* () {
        const handlers = yield* RoadmapColumnRpcHandlersEffect;
        const fixture = yield* makeFixture("PUBLIC");
        const columns = yield* handlers.RoadmapColumnListPublic({
          organizationId: fixture.organizationId,
        });
        expect(columns).toMatchObject([{ id: fixture.columnId }]);
      })
    );
    it.effect("hides public columns when the site hides the roadmap", () =>
      Effect.gen(function* () {
        const handlers = yield* RoadmapColumnRpcHandlersEffect;
        const fixture = yield* makeFixture("HIDDEN");
        const error = yield* Effect.flip(
          handlers.RoadmapColumnListPublic({
            organizationId: fixture.organizationId,
          })
        );
        expect(error).toMatchObject({ _tag: "PolicyDenied" });
      })
    );
  });
});
