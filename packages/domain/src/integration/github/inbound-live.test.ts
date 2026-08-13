import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  IntegrationExternalResourceType,
  IntegrationProviderKey,
} from "@feeblo/db/validation-schema/integration";
import {
  BoardId,
  GitHubSyncRuleId,
  IntegrationConnectionId,
  IntegrationExternalResourceId,
  PostExternalResourceLinkId,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { GitHubInboundServiceLive } from "./inbound-live";
import { GitHubInboundService } from "./inbound-service";

const TestLayer = Layer.mergeAll(
  GitHubInboundServiceLive.pipe(Layer.provide(Database.PgliteDatabaseLive)),
  Database.PgliteDatabaseLive
);

describe("GitHub inbound synchronization", () => {
  layer(TestLayer)("issue status rules", (it) => {
    it.effect(
      "sets the Feeblo status when any linked GitHub issue is closed",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const inbound = yield* GitHubInboundService;
          const organizationId = yield* WorkspaceId.generate;
          const boardId = yield* BoardId.generate;
          const openStatusId = yield* PostStatusId.generate;
          const closedStatusId = yield* PostStatusId.generate;
          const postId = yield* PostId.generate;
          const connectionId = yield* IntegrationConnectionId.generate;
          const externalResourceId =
            yield* IntegrationExternalResourceId.generate;
          const linkId = yield* PostExternalResourceLinkId.generate;
          const ruleId = yield* GitHubSyncRuleId.generate;
          const now = new Date();

          yield* db.insert(schema.organizationTable).values({
            id: organizationId,
            name: "GitHub rule test",
            slug: `github-rule-${organizationId}`,
            createdAt: now,
          });
          yield* db.insert(schema.boardTable).values({
            id: boardId,
            organizationId,
            name: "Feedback",
            slug: "feedback",
            visibility: "PRIVATE",
            createdAt: now,
            updatedAt: now,
          });
          yield* db.insert(schema.postStatusTable).values([
            {
              id: openStatusId,
              organizationId,
              type: "PENDING",
              orderIndex: 0,
            },
            {
              id: closedStatusId,
              organizationId,
              type: "CLOSED",
              orderIndex: 1,
            },
          ]);
          yield* db.insert(schema.postTable).values({
            id: postId,
            organizationId,
            boardId,
            statusId: openStatusId,
            title: "Close this post",
            slug: "close-this-post",
            content: "Content",
            createdAt: now,
            updatedAt: now,
          });
          yield* db.insert(schema.integrationConnectionTable).values({
            id: connectionId,
            organizationId,
            provider: IntegrationProviderKey.make("github"),
            name: "GitHub installation",
            lifecycle: "active",
          });
          yield* db.insert(schema.githubInstallationTable).values({
            connectionId,
            installationId: "12345",
            accountId: "67890",
            accountLogin: "feeblo-test",
            accountType: "Organization",
          });
          yield* db.insert(schema.integrationExternalResourceTable).values({
            id: externalResourceId,
            organizationId,
            connectionId,
            resourceType: IntegrationExternalResourceType.make("issue"),
            remoteId: "I_test",
            remoteUrl: "https://github.com/feeblo/test/issues/12",
            displayKey: "feeblo/test#12",
            title: "Linked issue",
            stateKey: "open",
            safeMetadata: {
              issueNumber: 12,
              repositoryName: "test",
              repositoryOwner: "feeblo",
            },
          });
          yield* db.insert(schema.postExternalResourceLinkTable).values({
            id: linkId,
            organizationId,
            postId,
            externalResourceId,
          });
          yield* db.insert(schema.githubSyncRuleTable).values({
            id: ruleId,
            organizationId,
            connectionId,
            issueMatchMode: "any",
            issueState: "closed",
            postStatusId: closedStatusId,
            upvoterNotificationPolicy: "do_not_notify_upvoters",
            enabled: true,
          });

          yield* inbound.applyIssueWebhook({
            deliveryId: "delivery-close-12",
            eventName: "issues",
            installationId: "12345",
            issueNumber: 12,
            issueState: "closed",
            repositoryName: "test",
            repositoryOwner: "feeblo",
          });

          const [post] = yield* db
            .select({ statusId: schema.postTable.statusId })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, postId));
          expect(post?.statusId).toBe(closedStatusId);
        })
    );
  });
});
