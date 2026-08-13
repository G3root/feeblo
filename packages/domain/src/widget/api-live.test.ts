import { expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { ChangelogId, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import { ChangelogRepository } from "../changelog/repository";
import { ClientIp } from "../client-ip";
import { withPublicHttpRateLimit } from "../rate-limit";
import { RateLimitService } from "../rate-limit/service";
import { InternalServerError } from "../rpc-errors";
import { listWidgetUpdates } from "./api-live";

const TestLayer = Layer.mergeAll(
  Database.PgliteDatabaseLive,
  ChangelogRepository.layer.pipe(Layer.provide(Database.PgliteDatabaseLive))
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
        const now = new Date();

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
        yield* db.insert(schema.changelogTable).values([
          {
            id: oldId,
            title: "Older release",
            slug: "older-release",
            content: "A useful improvement.",
            status: "published",
            publishedAt: new Date("2026-01-01T00:00:00Z"),
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
            publishedAt: new Date("2026-02-01T00:00:00Z"),
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
            publishedAt: new Date("2026-03-01T00:00:00Z"),
            organizationId: otherOrganizationId,
          },
          {
            id: scheduledId,
            title: "Scheduled",
            slug: "scheduled",
            content: "Not released yet.",
            status: "scheduled",
            scheduledAt: new Date("2026-04-01T00:00:00Z"),
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
        Effect.provide(RateLimitService.layerMemory),
        Effect.provideService(ClientIp, {
          _tag: "ClientIpAddress",
          address: "203.0.113.9",
        }),
        Effect.provideService(HttpServerRequest.HttpServerRequest, request)
      );
    }
  );
});
