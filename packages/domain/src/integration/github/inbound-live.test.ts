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
import { IntegrationEventRecorderLive } from "@feeblo/integration-core";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EmailOutboxConfig } from "../../email-outbox/config";
import { NotificationService } from "../../notification/service";
import { PostRepository } from "../../post/repository";
import { GitHubInboundServiceLive } from "./inbound-live";
import { GitHubInboundService } from "./inbound-service";

const TestLayer = Layer.mergeAll(
  GitHubInboundServiceLive.pipe(
    Layer.provide(NotificationService.layer),
    Layer.provide(IntegrationEventRecorderLive),
    Layer.provide(PostRepository.layer),
    Layer.provide(
      EmailOutboxConfig.layerTest(new URL("https://feeblo.example"))
    ),
    Layer.provide(Database.PgliteDatabaseLive)
  ),
  Database.PgliteDatabaseLive
);

const seedRuleScenario = ({
  linkedIssueStates,
  rules,
}: {
  readonly linkedIssueStates: readonly ("open" | "closed")[];
  readonly rules: readonly {
    readonly issueMatchMode: "all" | "any";
    readonly issueState: "open" | "closed";
    readonly targetStatus: "completed" | "closed";
    readonly enabled?: boolean;
    readonly createdAt?: Date;
  }[];
}) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const now = new Date();
    const organizationId = yield* WorkspaceId.generate;
    const boardId = yield* BoardId.generate;
    const openStatusId = yield* PostStatusId.generate;
    const completedStatusId = yield* PostStatusId.generate;
    const closedStatusId = yield* PostStatusId.generate;
    const postId = yield* PostId.generate;
    const connectionId = yield* IntegrationConnectionId.generate;
    const installationId = `gh-installation-${organizationId}`;

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
        id: completedStatusId,
        organizationId,
        type: "COMPLETED",
        orderIndex: 1,
      },
      {
        id: closedStatusId,
        organizationId,
        type: "CLOSED",
        orderIndex: 2,
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
      installationId,
      accountId: "67890",
      accountLogin: "feeblo-test",
      accountType: "Organization",
    });

    for (const [index, stateKey] of linkedIssueStates.entries()) {
      const externalResourceId = yield* IntegrationExternalResourceId.generate;
      const linkId = yield* PostExternalResourceLinkId.generate;
      const issueNumber = index + 10;
      yield* db.insert(schema.integrationExternalResourceTable).values({
        id: externalResourceId,
        organizationId,
        connectionId,
        resourceType: IntegrationExternalResourceType.make("issue"),
        remoteId: `I_test_${issueNumber}`,
        remoteUrl: `https://github.com/feeblo/test/issues/${issueNumber}`,
        displayKey: `feeblo/test#${issueNumber}`,
        title: "Linked issue",
        stateKey,
        safeMetadata: {
          issueNumber,
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
    }

    const targetStatusIds = {
      completed: completedStatusId,
      closed: closedStatusId,
    } as const;

    for (const rule of rules) {
      const ruleId = yield* GitHubSyncRuleId.generate;
      yield* db.insert(schema.githubSyncRuleTable).values({
        id: ruleId,
        organizationId,
        connectionId,
        issueMatchMode: rule.issueMatchMode,
        issueState: rule.issueState,
        postStatusId: targetStatusIds[rule.targetStatus],
        upvoterNotificationPolicy: "do_not_notify_upvoters",
        enabled: rule.enabled ?? true,
        ...(rule.createdAt === undefined ? undefined : { createdAt: rule.createdAt }),
      });
    }

    return {
      closedStatusId,
      completedStatusId,
      installationId,
      openStatusId,
      postId,
    };
  });

describe("GitHub inbound synchronization", () => {
  layer(TestLayer)("issue status rules", (it) => {
    it.effect("sets the Feeblo status when a linked GitHub issue closes", () =>
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
          issueMatchMode: "all",
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

    it.effect(
      "sets the Feeblo status only once all linked issues match an all rule",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const inbound = yield* GitHubInboundService;
          const seeded = yield* seedRuleScenario({
            linkedIssueStates: ["open", "open"],
            rules: [
              {
                issueMatchMode: "all",
                issueState: "closed",
                targetStatus: "closed",
              },
            ],
          });

          yield* inbound.applyIssueWebhook({
            deliveryId: "delivery-close-first",
            eventName: "issues",
            installationId: seeded.installationId,
            issueNumber: 10,
            issueState: "closed",
            repositoryName: "test",
            repositoryOwner: "feeblo",
          });
          const [afterFirst] = yield* db
            .select({ statusId: schema.postTable.statusId })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, seeded.postId));
          expect(afterFirst?.statusId).toBe(seeded.openStatusId);

          yield* inbound.applyIssueWebhook({
            deliveryId: "delivery-close-second",
            eventName: "issues",
            installationId: seeded.installationId,
            issueNumber: 11,
            issueState: "closed",
            repositoryName: "test",
            repositoryOwner: "feeblo",
          });
          const [afterSecond] = yield* db
            .select({ statusId: schema.postTable.statusId })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, seeded.postId));
          expect(afterSecond?.statusId).toBe(seeded.closedStatusId);
        })
    );

    it.effect(
      "switches to the any-open rule when a linked issue is reopened",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const inbound = yield* GitHubInboundService;
          const seeded = yield* seedRuleScenario({
            linkedIssueStates: ["closed", "closed"],
            rules: [
              {
                issueMatchMode: "all",
                issueState: "closed",
                targetStatus: "completed",
              },
              {
                issueMatchMode: "any",
                issueState: "open",
                targetStatus: "closed",
              },
            ],
          });

          yield* inbound.applyIssueWebhook({
            deliveryId: "delivery-reopen",
            eventName: "issues",
            installationId: seeded.installationId,
            issueNumber: 10,
            issueState: "open",
            repositoryName: "test",
            repositoryOwner: "feeblo",
          });
          const [post] = yield* db
            .select({ statusId: schema.postTable.statusId })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, seeded.postId));
          expect(post?.statusId).toBe(seeded.closedStatusId);
        })
    );

    it.effect(
      "ignores a disabled rule and applies an enabled matching rule",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const inbound = yield* GitHubInboundService;
          const seeded = yield* seedRuleScenario({
            linkedIssueStates: ["closed"],
            rules: [
              {
                issueMatchMode: "all",
                issueState: "closed",
                targetStatus: "completed",
                enabled: false,
              },
              {
                issueMatchMode: "any",
                issueState: "open",
                targetStatus: "closed",
              },
            ],
          });

          yield* inbound.applyIssueWebhook({
            deliveryId: "delivery-disabled-rule",
            eventName: "issues",
            installationId: seeded.installationId,
            issueNumber: 10,
            issueState: "open",
            repositoryName: "test",
            repositoryOwner: "feeblo",
          });
          const [post] = yield* db
            .select({ statusId: schema.postTable.statusId })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, seeded.postId));
          expect(post?.statusId).toBe(seeded.closedStatusId);
        })
    );

    it.effect("ignores a non-matching rule and applies the matching rule", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const inbound = yield* GitHubInboundService;
        const seeded = yield* seedRuleScenario({
          linkedIssueStates: ["open"],
          rules: [
            {
              issueMatchMode: "all",
              issueState: "closed",
              targetStatus: "closed",
            },
            {
              issueMatchMode: "any",
              issueState: "open",
              targetStatus: "completed",
            },
          ],
        });

        yield* inbound.applyIssueWebhook({
          deliveryId: "delivery-multi-rule-nonmatching",
          eventName: "issues",
          installationId: seeded.installationId,
          issueNumber: 10,
          issueState: "open",
          repositoryName: "test",
          repositoryOwner: "feeblo",
        });
        const [post] = yield* db
          .select({ statusId: schema.postTable.statusId })
          .from(schema.postTable)
          .where(eq(schema.postTable.id, seeded.postId));
        expect(post?.statusId).toBe(seeded.completedStatusId);
      })
    );
  });
});
