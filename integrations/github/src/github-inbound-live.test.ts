import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  IntegrationExternalResourceType,
  IntegrationProviderKey,
} from "@feeblo/domain-contracts/integration";
import { EmailOutboxConfig } from "@feeblo/domain/email-outbox/config";
import { GitHubInboundService } from "@feeblo/domain/integration/github/inbound-service";
import { NotificationService } from "@feeblo/domain/notification/service";
import { PostRepository } from "@feeblo/domain/post/repository";
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
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { GitHubInboundServiceLive } from "./github-inbound-live";

/**
 * Statements the test database executed, so a test can count the reads one
 * webhook issues. A test clears it before the call under test; the suite is
 * sequential, and the logger is the only writer.
 */
const executedStatements: string[] = [];

const DatabaseLive = Database.PgliteDatabaseLiveWithLogger({
  logQuery: (statement) =>
    Effect.sync(() => {
      executedStatements.push(statement);
    }),
});

/** How many statements read the GitHub synchronization rules since the reset. */
const ruleReadCount = () =>
  executedStatements.filter((statement) =>
    statement.includes("github_sync_rule")
  ).length;

const TestLayer = Layer.mergeAll(
  GitHubInboundServiceLive.pipe(
    Layer.provide(NotificationService.layer),
    Layer.provide(IntegrationEventRecorderLive),
    Layer.provide(PostRepository.layer),
    Layer.provide(
      EmailOutboxConfig.layerTest(new URL("https://feeblo.example"))
    ),
    Layer.provide(DatabaseLive)
  ),
  DatabaseLive
);

const seedRuleScenario = ({
  linkedIssueStates,
  rules,
  linkedPosts = 1,
}: {
  readonly linkedIssueStates: readonly ("open" | "closed")[];
  readonly linkedPosts?: number;
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
    const now = yield* DateTime.nowAsDate;
    const organizationId = yield* WorkspaceId.generate;
    const boardId = yield* BoardId.generate;
    const openStatusId = yield* PostStatusId.generate;
    const completedStatusId = yield* PostStatusId.generate;
    const closedStatusId = yield* PostStatusId.generate;
    const postId = yield* PostId.generate;
    const extraPostIds = yield* Effect.forEach(
      Array.from({ length: linkedPosts - 1 }, (_, index) => index),
      () => PostId.generate
    );
    const postIds = [postId, ...extraPostIds];
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
    yield* db.insert(schema.postTable).values(
      postIds.map((linkedPostId, index) => ({
        id: linkedPostId,
        organizationId,
        boardId,
        statusId: openStatusId,
        title: `Close this post ${index + 1}`,
        slug: `close-this-post-${index + 1}`,
        content: "Content",
        createdAt: now,
        updatedAt: now,
      }))
    );
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
      yield* Effect.forEach(postIds, (linkedPostId) =>
        Effect.gen(function* () {
          const linkId = yield* PostExternalResourceLinkId.generate;
          yield* db.insert(schema.postExternalResourceLinkTable).values({
            id: linkId,
            organizationId,
            postId: linkedPostId,
            externalResourceId,
          });
        })
      );
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
        ...(rule.createdAt === undefined
          ? undefined
          : { createdAt: rule.createdAt }),
      });
    }

    return {
      closedStatusId,
      completedStatusId,
      installationId,
      openStatusId,
      organizationId,
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
        const now = yield* DateTime.nowAsDate;

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

    it.effect(
      "reads the synchronization rules once for an issue linked to several posts",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const inbound = yield* GitHubInboundService;
          const seeded = yield* seedRuleScenario({
            linkedIssueStates: ["open"],
            linkedPosts: 2,
            rules: [
              {
                issueMatchMode: "all",
                issueState: "closed",
                targetStatus: "closed",
              },
            ],
          });

          executedStatements.length = 0;
          yield* inbound.applyIssueWebhook({
            deliveryId: "delivery-multi-post",
            eventName: "issues",
            installationId: seeded.installationId,
            issueNumber: 10,
            issueState: "closed",
            repositoryName: "test",
            repositoryOwner: "feeblo",
          });

          // Nothing in one envelope changes the rule list, so it is read once
          // for the delivery rather than once per linked post.
          expect(ruleReadCount()).toBe(1);
          const posts = yield* db
            .select({ statusId: schema.postTable.statusId })
            .from(schema.postTable)
            .where(eq(schema.postTable.organizationId, seeded.organizationId));
          expect(posts).toHaveLength(2);
          expect(
            posts.every((post) => post.statusId === seeded.closedStatusId)
          ).toBe(true);
        })
    );

    it.effect(
      "reads no synchronization rules for an issue the workspace never linked",
      () =>
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
            ],
          });

          executedStatements.length = 0;
          yield* inbound.applyIssueWebhook({
            deliveryId: "delivery-unlinked-issue",
            eventName: "issues",
            installationId: seeded.installationId,
            issueNumber: 99,
            issueState: "closed",
            repositoryName: "test",
            repositoryOwner: "feeblo",
          });

          expect(ruleReadCount()).toBe(0);
          const [post] = yield* db
            .select({ statusId: schema.postTable.statusId })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, seeded.postId));
          expect(post?.statusId).toBe(seeded.openStatusId);
        })
    );
  });
});
