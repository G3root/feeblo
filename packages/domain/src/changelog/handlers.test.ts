import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { ChangelogId, WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { EmailOutboxRepository } from "../email-outbox/repository";
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
      const productId = `product_${organizationId}`;
      yield* db.insert(schema.productTable).values({
        id: productId,
        name: "Starter",
        isRecurring: true,
        isArchived: false,
        externalOrganizationId: "feeblo",
        visibility: "public",
        metadata: { plan: "starter", variant: "monthly" },
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.subscriptionTable).values({
        id: `subscription_${organizationId}`,
        externalId: `external_${organizationId}`,
        organizationId,
        amount: 1000,
        cancelAtPeriodEnd: false,
        currency: "usd",
        recurringInterval: "month",
        recurringIntervalCount: 1,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 86_400_000),
        customerId: `customer_${organizationId}`,
        productId,
        createdAt: now,
        updatedAt: now,
      });
      return { membershipId, organizationId, userId } satisfies Fixture;
    });
  const Repositories = Layer.mergeAll(
    ChangelogRepository.layer,
    EmailOutboxRepository.layer,
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
            coverImage: null,
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
          excerpt: "Safe",
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
              coverImage: null,
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
    it.effect(
      "persists a promoted cover image and keeps its asset referenced",
      () =>
        Effect.gen(function* () {
          const handlers = yield* ChangelogRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const db = yield* currentDb;
          const id = yield* ChangelogId.generate;
          const assetId = `asset_${id}`;
          const temporaryUrl =
            "https://assets.example/tmp/editor-media/cover.png";
          const permanentUrl = "https://assets.example/editor-media/cover.png";
          yield* db.insert(schema.assetTable).values({
            id: assetId,
            bucket: "test-bucket",
            key: "tmp/editor-media/user/cover.png",
            url: temporaryUrl,
            kind: "editor_image",
            userId: fixture.userId,
          });
          yield* db.insert(schema.siteTable).values({
            id: `site_${id}`,
            name: "Test site",
            subdomain: `site-${id}`,
            changelogVisibility: "PUBLIC",
            organizationId: fixture.organizationId,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          yield* handlers
            .ChangelogCreate({
              assetIds: [assetId],
              coverImage: temporaryUrl,
              id,
              organizationId: fixture.organizationId,
              title: "Release",
              slug: "release",
              content: "Body",
              status: "published",
              scheduledAt: null,
              publishedAt: new Date(),
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
                    key: "editor-media/user/cover.png",
                    url: permanentUrl,
                  }),
                deleteObject: () =>
                  Effect.succeed({ $metadata: { httpStatusCode: 204 } }),
              })
            );

          const [entry] = yield* db
            .select({ coverImage: schema.changelogTable.coverImage })
            .from(schema.changelogTable)
            .where(eq(schema.changelogTable.id, id));
          const references = yield* db
            .select()
            .from(schema.changelogAssetTable)
            .where(eq(schema.changelogAssetTable.changelogId, id));
          const listed = yield* handlers
            .ChangelogListPublic({
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(entry?.coverImage).toBe(permanentUrl);
          expect(references).toEqual([{ changelogId: id, assetId }]);
          expect(listed[0]?.coverImage).toBe(permanentUrl);

          // Simulate a re-save after a client reload: the cover asset id is
          // unknown (assetIds empty) but the cover URL is unchanged, so the
          // reference must survive so the asset is not garbage collected.
          yield* handlers
            .ChangelogUpdate({
              assetIds: [],
              coverImage: permanentUrl,
              id,
              organizationId: fixture.organizationId,
              title: "Release",
              slug: "release",
              content: "Body",
              status: "published",
              scheduledAt: null,
              publishedAt: new Date(),
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const referencesAfterResave = yield* db
            .select()
            .from(schema.changelogAssetTable)
            .where(eq(schema.changelogAssetTable.changelogId, id));
          expect(referencesAfterResave).toEqual([{ changelogId: id, assetId }]);

          // Removing the cover image prunes the reference again.
          yield* handlers
            .ChangelogUpdate({
              assetIds: [],
              coverImage: null,
              id,
              organizationId: fixture.organizationId,
              title: "Release",
              slug: "release",
              content: "Body",
              status: "published",
              scheduledAt: null,
              publishedAt: new Date(),
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const referencesAfterRemove = yield* db
            .select()
            .from(schema.changelogAssetTable)
            .where(eq(schema.changelogAssetTable.changelogId, id));
          expect(referencesAfterRemove).toEqual([]);

          // A cover URL that matches no caller-owned asset is retained
          // verbatim, but produces no asset reference (there is nothing to
          // keep alive).
          const unmatchedCoverUrl =
            "https://assets.example/unmatched/cover.png";
          yield* handlers
            .ChangelogUpdate({
              assetIds: [],
              coverImage: unmatchedCoverUrl,
              id,
              organizationId: fixture.organizationId,
              title: "Release",
              slug: "release",
              content: "Body",
              status: "published",
              scheduledAt: null,
              publishedAt: new Date(),
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const [entryAfterUnmatched] = yield* db
            .select({ coverImage: schema.changelogTable.coverImage })
            .from(schema.changelogTable)
            .where(eq(schema.changelogTable.id, id));
          const referencesAfterUnmatched = yield* db
            .select()
            .from(schema.changelogAssetTable)
            .where(eq(schema.changelogAssetTable.changelogId, id));
          expect(entryAfterUnmatched?.coverImage).toBe(unmatchedCoverUrl);
          expect(referencesAfterUnmatched).toEqual([]);
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
              coverImage: null,
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

    it.effect(
      "records one email intent when a changelog is first published",
      () =>
        Effect.gen(function* () {
          const handlers = yield* ChangelogRpcHandlersEffect;
          const outbox = yield* EmailOutboxRepository;
          const fixture = yield* makeFixture();
          const id = yield* ChangelogId.generate;
          const session = makeSession(fixture);

          yield* handlers
            .ChangelogCreate({
              assetIds: [],
              coverImage: null,
              id,
              organizationId: fixture.organizationId,
              title: "Published release",
              slug: "published-release",
              content: "First publication",
              status: "published",
              scheduledAt: null,
              publishedAt: new Date(),
            })
            .pipe(Effect.provideService(CurrentSession, session));

          const intents = yield* outbox.findPending({
            before: new Date(Date.now() + 60_000),
            organizationId: fixture.organizationId,
          });
          expect(intents.map(({ kind }) => kind)).toEqual([
            "changelog.published",
          ]);
        })
    );

    it.effect(
      "does not send publication again when an already-published changelog is edited",
      () =>
        Effect.gen(function* () {
          const handlers = yield* ChangelogRpcHandlersEffect;
          const outbox = yield* EmailOutboxRepository;
          const fixture = yield* makeFixture();
          const id = yield* ChangelogId.generate;
          const session = makeSession(fixture);
          const publishedAt = new Date();

          yield* handlers
            .ChangelogCreate({
              assetIds: [],
              coverImage: null,
              id,
              organizationId: fixture.organizationId,
              title: "Draft release",
              slug: "draft-release",
              content: "Draft",
              status: "draft",
              scheduledAt: null,
              publishedAt: null,
            })
            .pipe(Effect.provideService(CurrentSession, session));
          yield* handlers
            .ChangelogUpdate({
              assetIds: [],
              coverImage: null,
              id,
              organizationId: fixture.organizationId,
              title: "Published release",
              slug: "published-release",
              content: "Published",
              status: "published",
              scheduledAt: null,
              publishedAt,
            })
            .pipe(Effect.provideService(CurrentSession, session));
          yield* handlers
            .ChangelogUpdate({
              assetIds: [],
              coverImage: null,
              id,
              organizationId: fixture.organizationId,
              title: "Edited release",
              slug: "edited-release",
              content: "Edited after publication",
              status: "published",
              scheduledAt: null,
              publishedAt,
            })
            .pipe(Effect.provideService(CurrentSession, session));

          const intents = yield* outbox.findPending({
            before: new Date(Date.now() + 60_000),
            organizationId: fixture.organizationId,
          });
          expect(intents.map(({ kind }) => kind)).toEqual([
            "changelog.published",
          ]);
        })
    );

    it.effect(
      "records distinct explicit changelog update requests idempotently",
      () =>
        Effect.gen(function* () {
          const handlers = yield* ChangelogRpcHandlersEffect;
          const outbox = yield* EmailOutboxRepository;
          const fixture = yield* makeFixture();
          const id = yield* ChangelogId.generate;
          const session = makeSession(fixture);

          yield* handlers
            .ChangelogCreate({
              assetIds: [],
              coverImage: null,
              id,
              organizationId: fixture.organizationId,
              title: "Published release",
              slug: "published-release",
              content: "Published",
              status: "published",
              scheduledAt: null,
              publishedAt: new Date(),
            })
            .pipe(Effect.provideService(CurrentSession, session));

          const sendUpdate = (requestId: string) =>
            handlers
              .ChangelogSendUpdate({
                id,
                organizationId: fixture.organizationId,
                requestId,
              })
              .pipe(Effect.provideService(CurrentSession, session));

          yield* sendUpdate("request-one");
          yield* sendUpdate("request-one");
          yield* sendUpdate("request-two");

          const intents = yield* outbox.findPending({
            before: new Date(Date.now() + 60_000),
            organizationId: fixture.organizationId,
          });
          expect(intents.map(({ kind }) => kind)).toEqual([
            "changelog.published",
            "changelog.update_requested",
            "changelog.update_requested",
          ]);
        })
    );
  });
});
