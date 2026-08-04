import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { ChangelogId, WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { EntitlementPolicy } from "../entitlement/policies";
import { S3UploadService } from "../services/s3";
import { S3Test } from "../services/s3-test";
import { CurrentSession, type Session } from "../session-middleware";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { ChangelogRpcHandlersEffect } from "./handlers";
import { ChangelogPolicy } from "./policies";
import { ChangelogRepository } from "./repository";

describe("ChangelogRpcHandlers", () => {
  type Fixture = {
    membershipId: string;
    organizationId: string;
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
  const Repositories = Layer.mergeAll(
    ChangelogRepository.layer,
    SiteRepository.layer,
    WorkspaceRepository.layer
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));
  const Entitlements = EntitlementPolicy.layer.pipe(
    Layer.provide(Repositories)
  );
  const Policies = Layer.mergeAll(ChangelogPolicy.layer, SitePolicy.layer).pipe(
    Layer.provide(Entitlements),
    Layer.provide(Repositories)
  );
  const TestLayer = Layer.mergeAll(
    Repositories,
    Entitlements,
    Policies,
    Database.PgliteDatabaseLive,
    S3Test
  );

  layer(TestLayer)("handlers", (it) => {
    it.effect("creates sanitized changelog entries for members", () =>
      Effect.gen(function* () {
        const handlers = yield* ChangelogRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const id = yield* ChangelogId.generate;
        yield* handlers
          .ChangelogCreate({
            assetIds: [],
            id,
            organizationId: fixture.organizationId,
            title: "Release",
            slug: "",
            content: "Safe\n\n<script>alert(1)</script>",
            status: "draft",
            scheduledAt: null,
            publishedAt: null,
          })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
        const entries = yield* handlers
          .ChangelogList({ organizationId: fixture.organizationId })
          .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));
        expect(entries[0]).toMatchObject({
          id,
          slug: "release",
          content: "Safe\n",
          creatorMemberId: fixture.membershipId,
        });
      })
    );
    it.effect(
      "promotes temporary media and stores its changelog reference",
      () =>
        Effect.gen(function* () {
          const handlers = yield* ChangelogRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const db = yield* currentDb;
          const id = yield* ChangelogId.generate;
          const assetId = `asset_${id}`;
          const temporaryUrl =
            "https://assets.example/tmp/editor-media/image.png";
          const permanentUrl = "https://assets.example/editor-media/image.png";
          const promotions = yield* Ref.make<{ bucket: string; key: string }[]>(
            []
          );
          yield* db.insert(schema.assetTable).values({
            id: assetId,
            bucket: "test-bucket",
            key: "tmp/editor-media/user/image.png",
            url: temporaryUrl,
            kind: "editor_image",
            userId: fixture.userId,
          });

          yield* handlers
            .ChangelogCreate({
              assetIds: [assetId],
              id,
              organizationId: fixture.organizationId,
              title: "Release",
              slug: "release",
              content: `![image](${temporaryUrl})`,
              status: "draft",
              scheduledAt: null,
              publishedAt: null,
            })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture)),
              Effect.provideService(S3UploadService, {
                uploadProfileImage: () => Effect.die("not used in this test"),
                uploadOrganizationLogo: () =>
                  Effect.die("not used in this test"),
                uploadEditorMedia: () => Effect.die("not used in this test"),
                promoteEditorMedia: ({ bucket, key }) =>
                  Ref.update(promotions, (records) => [
                    ...records,
                    { bucket, key },
                  ]).pipe(
                    Effect.as({
                      bucket,
                      key: "editor-media/user/image.png",
                      url: "https://assets.example/editor-media/image.png",
                    })
                  ),
                deleteObject: () =>
                  Effect.succeed({ $metadata: { httpStatusCode: 204 } }),
              })
            );

          const [entry] = yield* db
            .select({ content: schema.changelogTable.content })
            .from(schema.changelogTable)
            .where(eq(schema.changelogTable.id, id));
          const references = yield* db
            .select()
            .from(schema.changelogAssetTable)
            .where(eq(schema.changelogAssetTable.changelogId, id));
          expect(entry?.content).toContain(permanentUrl);
          expect(references).toEqual([{ changelogId: id, assetId }]);
          expect(yield* Ref.get(promotions)).toEqual([
            { bucket: "test-bucket", key: "tmp/editor-media/user/image.png" },
          ]);
        })
    );
    it.effect("removes promoted media when the transaction fails", () =>
      Effect.gen(function* () {
        const deletedKeys = yield* Ref.make<string[]>([]);
        const handlers = yield* ChangelogRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const db = yield* currentDb;
        const id = yield* ChangelogId.generate;
        const assetId = `asset_${id}`;
        const temporaryUrl = "https://assets.example/tmp/editor-media/fail.png";
        yield* db.insert(schema.assetTable).values({
          id: assetId,
          bucket: "test-bucket",
          key: "tmp/editor-media/user/fail.png",
          url: temporaryUrl,
          kind: "editor_image",
          userId: fixture.userId,
        });
        yield* db.insert(schema.changelogTable).values({
          id,
          organizationId: fixture.organizationId,
          title: "Existing",
          slug: "existing",
          content: "",
          status: "draft",
          creatorId: fixture.userId,
        });

        const exit = yield* Effect.exit(
          handlers
            .ChangelogCreate({
              assetIds: [assetId],
              id,
              organizationId: fixture.organizationId,
              title: "Duplicate",
              slug: "duplicate",
              content: `![image](${temporaryUrl})`,
              status: "draft",
              scheduledAt: null,
              publishedAt: null,
            })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture)),
              Effect.provideService(S3UploadService, {
                uploadProfileImage: () => Effect.die("not used in this test"),
                uploadOrganizationLogo: () =>
                  Effect.die("not used in this test"),
                uploadEditorMedia: () => Effect.die("not used in this test"),
                promoteEditorMedia: ({ bucket }) =>
                  Effect.succeed({
                    bucket,
                    key: "editor-media/user/fail.png",
                    url: "https://assets.example/editor-media/fail.png",
                  }),
                deleteObject: (_bucket, key) =>
                  Ref.update(deletedKeys, (keys) => [...keys, key]).pipe(
                    Effect.as({ $metadata: { httpStatusCode: 204 } })
                  ),
              })
            )
        );

        expect(exit._tag).toBe("Failure");
        expect(yield* Ref.get(deletedKeys)).toContain(
          "editor-media/user/fail.png"
        );
      })
    );
    it.effect("rejects non-members from listing changelog entries", () =>
      Effect.gen(function* () {
        const handlers = yield* ChangelogRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const error = yield* Effect.flip(
          handlers
            .ChangelogList({ organizationId: fixture.organizationId })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture, false))
            )
        );
        expect(error._tag).toBe("PolicyDenied");
      })
    );
  });
});
