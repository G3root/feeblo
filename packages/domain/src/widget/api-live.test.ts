import { expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { ChangelogId, WorkspaceId } from "@feeblo/id";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as Layer from "effect/Layer";

import { ChangelogRepository } from "../changelog/repository";
import { ClientIp } from "../client-ip";
import { EntitlementPolicy } from "../entitlement/policies";
import { withPublicHttpRateLimit } from "../rate-limit";
import { RateLimitService } from "../rate-limit/service";
import { InternalServerError } from "../rpc-errors";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { listWidgetUpdates } from "./api-live";

/** The `Date` for a known instant, built through `DateTime`. */
const dateAt = (instant: string | number | Date): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(instant));

const SitePolicyLayer = SitePolicy.layer.pipe(
  Layer.provide(SiteRepository.layer),
  Layer.provide(
    EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer))
  )
);

const TestLayer = Layer.mergeAll(
  Database.PgliteDatabaseLive,
  ChangelogRepository.layer.pipe(Layer.provide(Database.PgliteDatabaseLive)),
  SitePolicyLayer.pipe(Layer.provideMerge(Database.PgliteDatabaseLive))
);

layer(TestLayer)("widget updates", (it) => {
  it.effect(
    "returns only the organization's published updates newest first",
    () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const organizationId = yield* WorkspaceId.generate;
        const otherOrganizationId = yield* WorkspaceId.generate;
        const oldId = yield* ChangelogId.generate;
        const newId = yield* ChangelogId.generate;
        const draftId = yield* ChangelogId.generate;
        const scheduledId = yield* ChangelogId.generate;
        const foreignId = yield* ChangelogId.generate;
        const now = yield* DateTime.nowAsDate;

        yield* db.insert(schema.organizationTable).values([
          {
            id: organizationId,
            name: "Widget org",
            slug: organizationId,
            createdAt: now,
          },
          {
            id: otherOrganizationId,
            name: "Other org",
            slug: otherOrganizationId,
            createdAt: now,
          },
        ]);
        // The endpoint is unauthenticated and `organizationId` comes from the
        // query string, so the site's changelog privacy is the only thing
        // standing between a caller and a hidden changelog.
        yield* db.insert(schema.siteTable).values({
          id: `site_${organizationId}`,
          organizationId,
          subdomain: "widget-org",
          name: "Widget org",
          changelogVisibility: "PUBLIC",
          createdAt: now,
          updatedAt: now,
        });
        yield* db.insert(schema.changelogTable).values([
          {
            id: oldId,
            title: "Older release",
            slug: "older-release",
            content: "A useful improvement.",
            status: "published",
            publishedAt: dateAt("2026-01-01T00:00:00Z"),
            organizationId,
          },
          {
            id: newId,
            title: "Newest release",
            slug: "newest-release",
            content:
              "![Cover](https://cdn.example.com/cover.png)\n\nThe newest improvement.",
            // The app stores these at edit time (see changelog/handlers.ts);
            // seed them the same way so the widget returns real data.
            excerpt: "The newest improvement.",
            coverImage: "https://cdn.example.com/cover.png",
            status: "published",
            publishedAt: dateAt("2026-02-01T00:00:00Z"),
            organizationId,
          },
          {
            id: draftId,
            title: "Draft",
            slug: "draft",
            content: "Not public.",
            status: "draft",
            organizationId,
          },
          {
            id: foreignId,
            title: "Foreign release",
            slug: "foreign-release",
            content: "Not from this organization.",
            status: "published",
            publishedAt: dateAt("2026-03-01T00:00:00Z"),
            organizationId: otherOrganizationId,
          },
          {
            id: scheduledId,
            title: "Scheduled",
            slug: "scheduled",
            content: "Not released yet.",
            status: "scheduled",
            scheduledAt: dateAt("2026-04-01T00:00:00Z"),
            organizationId,
          },
        ]);

        const updates = yield* listWidgetUpdates({ organizationId });

        expect(updates.map((update) => update.id)).toEqual([newId, oldId]);
        expect(updates[0]).toMatchObject({
          excerpt: "The newest improvement.",
          imageUrl: "https://cdn.example.com/cover.png",
        });
        expect(updates[0]?.content).toContain("<img");
      })
  );

  it.effect("returns nothing when the workspace has hidden its changelog", () =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const hiddenOrganizationId = yield* WorkspaceId.generate;
      const publicOrganizationId = yield* WorkspaceId.generate;
      const hiddenEntryId = yield* ChangelogId.generate;
      const publicEntryId = yield* ChangelogId.generate;
      const now = yield* DateTime.nowAsDate;

      yield* db.insert(schema.organizationTable).values([
        {
          id: hiddenOrganizationId,
          name: "Hidden changelog org",
          slug: hiddenOrganizationId,
          createdAt: now,
        },
        {
          id: publicOrganizationId,
          name: "Public changelog org",
          slug: publicOrganizationId,
          createdAt: now,
        },
      ]);
      yield* db.insert(schema.siteTable).values([
        {
          id: `site_${hiddenOrganizationId}`,
          organizationId: hiddenOrganizationId,
          subdomain: "hidden-changelog-org",
          name: "Hidden changelog org",
          changelogVisibility: "HIDDEN",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: `site_${publicOrganizationId}`,
          organizationId: publicOrganizationId,
          subdomain: "public-changelog-org",
          name: "Public changelog org",
          changelogVisibility: "PUBLIC",
          createdAt: now,
          updatedAt: now,
        },
      ]);
      yield* db.insert(schema.changelogTable).values([
        {
          id: hiddenEntryId,
          title: "Unannounced",
          slug: "unannounced",
          content: "Not released yet.",
          status: "published",
          publishedAt: now,
          organizationId: hiddenOrganizationId,
        },
        {
          id: publicEntryId,
          title: "Announced",
          slug: "announced",
          content: "Released.",
          status: "published",
          publishedAt: now,
          organizationId: publicOrganizationId,
        },
      ]);

      // A workspace that hid its changelog published entries must not serve
      // them here. `[]` rather than an error: an error status would confirm
      // the organization exists to a caller who only guessed its id.
      expect(
        yield* listWidgetUpdates({ organizationId: hiddenOrganizationId })
      ).toEqual([]);
      expect(
        yield* listWidgetUpdates({ organizationId: publicOrganizationId })
      ).toHaveLength(1);
    })
  );

  it.effect("returns nothing for a workspace with no site at all", () =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const entryId = yield* ChangelogId.generate;
      const now = yield* DateTime.nowAsDate;

      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "No site org",
        slug: organizationId,
        createdAt: now,
      });
      yield* db.insert(schema.changelogTable).values({
        id: entryId,
        title: "Published",
        slug: "published",
        content: "Released.",
        status: "published",
        publishedAt: now,
        organizationId,
      });

      expect(yield* listWidgetUpdates({ organizationId })).toEqual([]);
    })
  );

  it.layer(RateLimitService.layerMemory)(
    "with an in-memory rate limiter",
    (it) => {
      it.effect(
        "preserves suggestion rate-limit errors instead of mapping them to 500",
        () => {
          const request = HttpServerRequest.fromWeb(
            new Request("http://localhost/api/widget/v1/suggestions")
          );
          const rateLimitedSuggestion = Effect.succeed("suggestions").pipe(
            Effect.mapError(
              () =>
                new InternalServerError({
                  message: "Failed to find similar posts",
                })
            ),
            withPublicHttpRateLimit({
              name: "WidgetSuggestPostsTest",
              level: "expensive",
              limit: 1,
            })
          );

          return Effect.gen(function* () {
            yield* rateLimitedSuggestion;
            const error = yield* Effect.flip(rateLimitedSuggestion);

            expect(error._tag).toBe("RateLimitExceededError");
          }).pipe(
            Effect.provideService(ClientIp, {
              _tag: "ClientIpAddress",
              address: "203.0.113.9",
            }),
            Effect.provideService(HttpServerRequest.HttpServerRequest, request)
          );
        }
      );
    }
  );
});
