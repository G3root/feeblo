import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  IntegrationExternalResourceType,
  IntegrationProviderKey,
} from "@feeblo/db/validation-schema/integration";
import {
  BoardId,
  IntegrationConnectionId,
  type LegidOf,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ExternalResourceServiceLive } from "./live";
import { ExternalResourceService } from "./service";

const TestLayer = Layer.mergeAll(
  ExternalResourceServiceLive.pipe(Layer.provide(Database.PgliteDatabaseLive)),
  Database.PgliteDatabaseLive
);

const seedPost = (suffix: string) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const organizationId = yield* WorkspaceId.generate;
    const boardId = yield* BoardId.generate;
    const statusId = yield* PostStatusId.generate;
    const postId = yield* PostId.generate;
    const now = new Date();
    yield* db.insert(schema.organizationTable).values({
      id: organizationId,
      name: `External resource ${suffix}`,
      slug: `external-resource-${suffix}-${organizationId}`,
      createdAt: now,
    });
    yield* db.insert(schema.boardTable).values({
      id: boardId,
      organizationId,
      name: "Feedback",
      slug: `feedback-${suffix}`,
      visibility: "PRIVATE",
      createdAt: now,
      updatedAt: now,
    });
    yield* db.insert(schema.postStatusTable).values({
      id: statusId,
      organizationId,
      type: "PENDING",
      orderIndex: 0,
    });
    yield* db.insert(schema.postTable).values({
      id: postId,
      organizationId,
      boardId,
      statusId,
      title: "Feedback",
      slug: `feedback-${suffix}`,
      content: "Content",
      createdAt: now,
      updatedAt: now,
    });
    return { organizationId, postId, boardId, statusId };
  });

const seedPostInOrganization = (
  organizationId: LegidOf<"WorkspaceId">,
  boardId: LegidOf<"BoardId">,
  statusId: LegidOf<"PostStatusId">,
  suffix: string
) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const postId = yield* PostId.generate;
    const now = new Date();
    yield* db.insert(schema.postTable).values({
      id: postId,
      organizationId,
      boardId,
      statusId,
      title: "Feedback",
      slug: `feedback-${suffix}`,
      content: "Content",
      createdAt: now,
      updatedAt: now,
    });
    return { organizationId, postId };
  });

const seedConnection = (
  organizationId: LegidOf<"WorkspaceId">,
  provider: string
) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const connectionId = yield* IntegrationConnectionId.generate;
    yield* db.insert(schema.integrationConnectionTable).values({
      id: connectionId,
      organizationId,
      provider: IntegrationProviderKey.make(provider),
      name: `${provider} connection`,
      lifecycle: "active",
    });
    return connectionId;
  });

const resource = (
  organizationId: LegidOf<"WorkspaceId">,
  connectionId: LegidOf<"IntegrationConnectionId">
) => ({
  organizationId,
  connectionId,
  resourceType: IntegrationExternalResourceType.make("issue"),
  remoteId: "ISSUE-123",
  remoteUrl: new URL("https://example.test/issues/ISSUE-123"),
  displayKey: "ISSUE-123",
  title: "A linked issue",
  stateKey: "open",
  safeMetadata: {},
});

describe("external resource service", () => {
  layer(TestLayer)("generic resource persistence", (it) => {
    it.effect(
      "lists cross-provider links, upserts duplicate remotes, links one resource to two posts, and reserves creation idempotently",
      () =>
        Effect.gen(function* () {
          const service = yield* ExternalResourceService;
          const first = yield* seedPost("first");
          const second = yield* seedPostInOrganization(
            first.organizationId,
            first.boardId,
            first.statusId,
            "second"
          );
          const github = yield* seedConnection(first.organizationId, "github");
          const linear = yield* seedConnection(first.organizationId, "linear");

          const githubFirst = yield* service.recordPostLink({
            postId: first.postId,
            resource: resource(first.organizationId, github),
          });
          const githubDuplicate = yield* service.recordPostLink({
            postId: first.postId,
            resource: {
              ...resource(first.organizationId, github),
              title: "Updated title",
            },
          });
          expect(githubDuplicate.externalResourceId).toBe(
            githubFirst.externalResourceId
          );
          expect(githubDuplicate.postExternalResourceLinkId).toBe(
            githubFirst.postExternalResourceLinkId
          );
          const afterDuplicate = yield* service.listPostLinks(first);
          expect(afterDuplicate[0]?.title).toBe("Updated title");

          yield* service.recordPostLink({
            postId: second.postId,
            resource: resource(first.organizationId, github),
          });
          yield* service.recordPostLink({
            postId: first.postId,
            resource: {
              ...resource(first.organizationId, linear),
              remoteId: "LIN-99",
              displayKey: "LIN-99",
            },
          });

          const firstLinks = yield* service.listPostLinks(first);
          expect(firstLinks).toHaveLength(2);
          expect(firstLinks.map((link) => link.provider).sort()).toEqual([
            "github",
            "linear",
          ]);
          const secondLinks = yield* service.listPostLinks(second);
          expect(secondLinks).toHaveLength(1);
          expect(secondLinks[0]?.id).not.toBe(
            githubFirst.postExternalResourceLinkId
          );

          const reserved = yield* service.reserveCreation({
            connectionId: github,
            organizationId: first.organizationId,
            postId: first.postId,
            idempotencyKey: "create-github-issue",
          });
          const duplicate = yield* service.reserveCreation({
            connectionId: github,
            organizationId: first.organizationId,
            postId: first.postId,
            idempotencyKey: "create-github-issue",
          });
          expect(reserved.reserved).toBe(true);
          expect(duplicate.reserved).toBe(false);
          expect(duplicate.id).toBe(reserved.id);
          yield* service.failCreation({ requestId: reserved.id });
          const retried = yield* service.reserveCreation({
            connectionId: github,
            organizationId: first.organizationId,
            postId: first.postId,
            idempotencyKey: "create-github-issue",
          });
          expect(retried.reserved).toBe(true);
        })
    );
  });
});
