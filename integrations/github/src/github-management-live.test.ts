import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { IntegrationProviderKey } from "@feeblo/domain-contracts/integration";
import {
  BoardId,
  GitHubSyncRuleId,
  IntegrationConnectionId,
  type LegidOf,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

import { EmailOutboxConfig } from "@feeblo/domain/email-outbox/config";
import { BadRequestError, InternalServerError } from "@feeblo/domain/rpc-errors";
import { ExternalResourceServiceLive } from "@feeblo/domain/integration/external-resource/live";
import { GitHubIntegrationConfig } from "@feeblo/domain/integration/github/config";
import { GitHubProvider, type GitHubProviderContract } from "./github-provider";
import { GitHubManagementServiceLive } from "./github-management-live";
import { GitHubManagementService } from "@feeblo/domain/integration/github/management-service";
import type { GitHubResolvedIssue } from "@feeblo/domain/integration/github/schema";

/** Recording fake provider; the test sets `createIssue` behavior per scenario. */
const makeFakeGitHubProvider = () => {
  const calls: string[] = [];
  let createIssueImpl: GitHubProviderContract["createIssue"] = () =>
    Effect.die("createIssue not configured");
  return {
    calls,
    reset: () => {
      calls.length = 0;
    },
    setCreateIssue: (impl: GitHubProviderContract["createIssue"]) => {
      createIssueImpl = impl;
    },
    service: GitHubProvider.of({
      completeInstallation: () => Effect.die("unused"),
      createIssue: (input) => {
        calls.push("createIssue");
        return createIssueImpl(input);
      },
      listRepositories: () => Effect.die("unused"),
      resolveIssue: () => Effect.die("unused"),
      startInstallation: () => Effect.die("unused"),
      uninstallInstallation: () => Effect.die("unused"),
    }),
  };
};

const testConfig = Layer.succeed(
  GitHubIntegrationConfig,
  GitHubIntegrationConfig.of({
    clientId: "client-id",
    configured: true,
  })
);

const makeTestLayer = () => {
  const provider = makeFakeGitHubProvider();
  return {
    provider,
    layer: Layer.mergeAll(
      GitHubManagementServiceLive.pipe(
        Layer.provide(Layer.succeed(GitHubProvider, provider.service)),
        Layer.provide(testConfig),
        Layer.provide(
          EmailOutboxConfig.layerTest(new URL("https://feeblo.example"))
        ),
        Layer.provide(ExternalResourceServiceLive),
        Layer.provide(Database.PgliteDatabaseLive)
      ),
      Database.PgliteDatabaseLive
    ),
  };
};

const seedPostWithConnection = Effect.gen(function* () {
  const db = yield* currentDb;
  const now = new Date();
  const organizationId = yield* WorkspaceId.generate;
  const boardId = yield* BoardId.generate;
  const postStatusId = yield* PostStatusId.generate;
  const postId = yield* PostId.generate;
  const connectionId = yield* IntegrationConnectionId.generate;

  yield* db.insert(schema.organizationTable).values({
    id: organizationId,
    name: "GitHub management test",
    slug: organizationId,
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
  yield* db.insert(schema.postStatusTable).values({
    id: postStatusId,
    organizationId,
    type: "PENDING",
    orderIndex: 0,
  });
  yield* db.insert(schema.postTable).values({
    id: postId,
    organizationId,
    boardId,
    statusId: postStatusId,
    title: "Dark mode",
    slug: "dark-mode",
    content: "Content",
    createdAt: now,
    updatedAt: now,
  });
  yield* db.insert(schema.integrationConnectionTable).values({
    id: connectionId,
    organizationId,
    provider: IntegrationProviderKey.make("github"),
    name: "GitHub",
    lifecycle: "active",
  });

  return { organizationId, postId, connectionId };
});

const seedRuleFixtures = Effect.gen(function* () {
  const db = yield* currentDb;
  const now = new Date();
  const organizationId = yield* WorkspaceId.generate;
  const connectionId = yield* IntegrationConnectionId.generate;
  const postStatusId = yield* PostStatusId.generate;

  yield* db.insert(schema.organizationTable).values({
    id: organizationId,
    name: "GitHub rule test",
    slug: organizationId,
    createdAt: now,
  });
  yield* db.insert(schema.postStatusTable).values({
    id: postStatusId,
    organizationId,
    type: "PENDING",
    orderIndex: 0,
  });
  yield* db.insert(schema.integrationConnectionTable).values({
    id: connectionId,
    organizationId,
    provider: IntegrationProviderKey.make("github"),
    name: "GitHub",
    lifecycle: "active",
  });

  return { organizationId, connectionId, postStatusId };
});

const ruleCreateInput = ({
  organizationId,
  connectionId,
  postStatusId,
}: {
  readonly organizationId: LegidOf<"WorkspaceId">;
  readonly connectionId: LegidOf<"IntegrationConnectionId">;
  readonly postStatusId: LegidOf<"PostStatusId">;
}) => ({
  organizationId,
  connectionId,
  issueMatchMode: "all" as const,
  issueState: "closed" as const,
  postStatusId,
  upvoterNotificationPolicy: "notify_upvoters" as const,
  enabled: true,
});

const createInput = ({
  organizationId,
  postId,
  connectionId,
  idempotencyKey = "issue-1",
}: {
  readonly organizationId: LegidOf<"WorkspaceId">;
  readonly postId: LegidOf<"PostId">;
  readonly connectionId: LegidOf<"IntegrationConnectionId">;
  readonly idempotencyKey?: string;
}) => ({
  organizationId,
  postId,
  connectionId,
  repositoryOwner: "acme",
  repositoryName: "feedback",
  idempotencyKey,
});

const succeedWithIssue = (input: {
  readonly connectionId: LegidOf<"IntegrationConnectionId">;
  readonly repositoryOwner: string;
  readonly repositoryName: string;
}): Effect.Effect<GitHubResolvedIssue> =>
  Effect.succeed({
    connectionId: input.connectionId,
    repositoryOwner: input.repositoryOwner,
    repositoryName: input.repositoryName,
    issueNumber: 7,
    remoteId: "I_7",
    issueUrl: new URL("https://github.com/acme/feedback/issues/7"),
    issueState: "open",
    title: "Dark mode",
  });

describe("GitHub management service", () => {
  const test = makeTestLayer();
  layer(test.layer)("createPostIssue idempotency", (it) => {
    it.effect(
      "records the created issue and marks the reservation succeeded",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* GitHubManagementService;
          const seeded = yield* seedPostWithConnection;
          test.provider.reset();
          test.provider.setCreateIssue((input) =>
            succeedWithIssue({
              connectionId: input.connectionId,
              repositoryOwner: input.repositoryOwner,
              repositoryName: input.repositoryName,
            })
          );

          const link = yield* service.createPostIssue(createInput(seeded));

          expect(link.displayKey).toBe("acme/feedback#7");
          const [request] = yield* db
            .select({ state: schema.externalResourceCreateRequestTable.state })
            .from(schema.externalResourceCreateRequestTable)
            .where(
              and(
                eq(
                  schema.externalResourceCreateRequestTable.idempotencyKey,
                  "issue-1"
                ),
                eq(
                  schema.externalResourceCreateRequestTable.connectionId,
                  seeded.connectionId
                )
              )
            );
          expect(request?.state).toBe("succeeded");

          const [resource] = yield* db
            .select({
              id: schema.integrationExternalResourceTable.id,
              remoteId: schema.integrationExternalResourceTable.remoteId,
              remoteUrl: schema.integrationExternalResourceTable.remoteUrl,
            })
            .from(schema.integrationExternalResourceTable)
            .where(
              and(
                eq(
                  schema.integrationExternalResourceTable.connectionId,
                  seeded.connectionId
                ),
                eq(schema.integrationExternalResourceTable.remoteId, "I_7")
              )
            );
          expect(resource?.remoteId).toBe("I_7");
          expect(resource?.remoteUrl).toBe(
            "https://github.com/acme/feedback/issues/7"
          );

          const [postLink] = yield* db
            .select({
              externalResourceId:
                schema.postExternalResourceLinkTable.externalResourceId,
              postId: schema.postExternalResourceLinkTable.postId,
            })
            .from(schema.postExternalResourceLinkTable)
            .where(
              and(
                eq(
                  schema.postExternalResourceLinkTable.externalResourceId,
                  resource?.id ?? "missing"
                ),
                eq(schema.postExternalResourceLinkTable.postId, seeded.postId)
              )
            );
          expect(postLink?.postId).toBe(seeded.postId);
          expect(postLink?.externalResourceId).toBe(resource?.id);
        })
    );

    it.effect(
      "retains the reservation when issue creation is indeterminate",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* GitHubManagementService;
          const seeded = yield* seedPostWithConnection;
          test.provider.reset();
          test.provider.setCreateIssue(() =>
            Effect.fail(
              new InternalServerError({
                message: "GitHub App issue creation failed.",
              })
            )
          );

          const first = yield* Effect.exit(
            service.createPostIssue(createInput(seeded))
          );
          expect(Exit.isFailure(first)).toBe(true);

          const [request] = yield* db
            .select({ state: schema.externalResourceCreateRequestTable.state })
            .from(schema.externalResourceCreateRequestTable)
            .where(
              and(
                eq(
                  schema.externalResourceCreateRequestTable.idempotencyKey,
                  "issue-1"
                ),
                eq(
                  schema.externalResourceCreateRequestTable.connectionId,
                  seeded.connectionId
                )
              )
            );
          expect(request?.state).toBe("pending");

          const second = yield* Effect.exit(
            service.createPostIssue(createInput(seeded))
          );
          expect(Exit.isFailure(second)).toBe(true);
          expect(
            test.provider.calls.filter((call) => call === "createIssue")
          ).toHaveLength(1);
        })
    );

    it.effect(
      "releases the reservation when the provider definitely rejected creation",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* GitHubManagementService;
          const seeded = yield* seedPostWithConnection;
          test.provider.reset();
          test.provider.setCreateIssue(() =>
            Effect.fail(
              new BadRequestError({
                message: "GitHub rejected issue creation.",
              })
            )
          );

          const first = yield* Effect.exit(
            service.createPostIssue(createInput(seeded))
          );
          expect(Exit.isFailure(first)).toBe(true);

          const [request] = yield* db
            .select({ state: schema.externalResourceCreateRequestTable.state })
            .from(schema.externalResourceCreateRequestTable)
            .where(
              and(
                eq(
                  schema.externalResourceCreateRequestTable.idempotencyKey,
                  "issue-1"
                ),
                eq(
                  schema.externalResourceCreateRequestTable.connectionId,
                  seeded.connectionId
                )
              )
            );
          expect(request?.state).toBe("failed");

          const second = yield* Effect.exit(
            service.createPostIssue(createInput(seeded))
          );
          expect(Exit.isFailure(second)).toBe(true);
          expect(
            test.provider.calls.filter((call) => call === "createIssue")
          ).toHaveLength(2);
        })
    );
  });

  layer(test.layer)("rule builder", (it) => {
    it.effect("creates a rule and lists it for its connection", () =>
      Effect.gen(function* () {
        const service = yield* GitHubManagementService;
        const seeded = yield* seedRuleFixtures;

        const created = yield* service.createRule(ruleCreateInput(seeded));
        const rules = yield* service.listRules({
          organizationId: seeded.organizationId,
          connectionId: seeded.connectionId,
        });

        expect(rules).toHaveLength(1);
        expect(rules[0]?.id).toBe(created.id);
        expect(rules[0]?.postStatusId).toBe(seeded.postStatusId);
        expect(rules[0]?.issueMatchMode).toBe("all");
        expect(rules[0]?.issueState).toBe("closed");
      })
    );

    it.effect("lists no rules for a connection with none configured", () =>
      Effect.gen(function* () {
        const service = yield* GitHubManagementService;
        const seeded = yield* seedRuleFixtures;

        const rules = yield* service.listRules({
          organizationId: seeded.organizationId,
          connectionId: seeded.connectionId,
        });

        expect(rules).toHaveLength(0);
      })
    );

    it.effect(
      "updates a rule's status, notification policy, and enabled flag without changing its shape",
      () =>
        Effect.gen(function* () {
          const service = yield* GitHubManagementService;
          const seeded = yield* seedRuleFixtures;
          const created = yield* service.createRule(ruleCreateInput(seeded)); // (all, closed)

          const updated = yield* service.updateRule({
            id: created.id,
            organizationId: seeded.organizationId,
            connectionId: created.connectionId,
            postStatusId: created.postStatusId,
            upvoterNotificationPolicy: "do_not_notify_upvoters",
            enabled: false,
          });
          const [persisted] = yield* service.listRules({
            organizationId: seeded.organizationId,
            connectionId: seeded.connectionId,
          });

          expect(updated.issueMatchMode).toBe("all");
          expect(updated.issueState).toBe("closed");
          expect(updated.enabled).toBe(false);
          expect(persisted?.issueMatchMode).toBe("all");
          expect(persisted?.issueState).toBe("closed");
          expect(persisted?.enabled).toBe(false);
          expect(persisted?.upvoterNotificationPolicy).toBe(
            "do_not_notify_upvoters"
          );
        })
    );

    it.effect("rejects a rule shape that is not hard-wired", () =>
      Effect.gen(function* () {
        const service = yield* GitHubManagementService;
        const seeded = yield* seedRuleFixtures;

        const result = yield* service
          .createRule({
            ...ruleCreateInput(seeded),
            issueMatchMode: "any",
            issueState: "closed",
          })
          .pipe(
            Effect.match({
              onFailure: (error) => error._tag,
              onSuccess: () => "success",
            })
          );

        expect(result).toBe("BadRequestError");
      })
    );

    it.effect("rejects a duplicate rule for the same issue states", () =>
      Effect.gen(function* () {
        const service = yield* GitHubManagementService;
        const seeded = yield* seedRuleFixtures;
        yield* service.createRule(ruleCreateInput(seeded)); // (all, closed)

        const result = yield* service.createRule(ruleCreateInput(seeded)).pipe(
          Effect.match({
            onFailure: (error) => error._tag,
            onSuccess: () => "success",
          })
        );

        expect(result).toBe("BadRequestError");
      })
    );

    it.effect("allows the any-open plus all-closed rule pair", () =>
      Effect.gen(function* () {
        const service = yield* GitHubManagementService;
        const seeded = yield* seedRuleFixtures;
        yield* service.createRule(ruleCreateInput(seeded)); // (all, closed)

        yield* service.createRule({
          ...ruleCreateInput(seeded),
          issueMatchMode: "any",
          issueState: "open",
        });
        const rules = yield* service.listRules({
          organizationId: seeded.organizationId,
          connectionId: seeded.connectionId,
        });

        expect(rules).toHaveLength(2);
      })
    );

    it.effect("deletes a rule so it no longer lists", () =>
      Effect.gen(function* () {
        const service = yield* GitHubManagementService;
        const seeded = yield* seedRuleFixtures;
        const created = yield* service.createRule(ruleCreateInput(seeded));

        yield* service.deleteRule({
          organizationId: seeded.organizationId,
          connectionId: seeded.connectionId,
          id: created.id,
        });
        const rules = yield* service.listRules({
          organizationId: seeded.organizationId,
          connectionId: seeded.connectionId,
        });

        expect(rules).toHaveLength(0);
      })
    );

    it.effect("rejects rule creation for a connection that is not active", () =>
      Effect.gen(function* () {
        const service = yield* GitHubManagementService;
        const seeded = yield* seedRuleFixtures;
        const missingConnectionId = yield* IntegrationConnectionId.generate;

        const result = yield* service
          .createRule(
            ruleCreateInput({ ...seeded, connectionId: missingConnectionId })
          )
          .pipe(
            Effect.match({
              onFailure: (error) => error._tag,
              onSuccess: () => "success",
            })
          );

        expect(result).toBe("NotFoundError");
      })
    );

    it.effect("rejects a non-hard-wired rule shape at the database level", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const seeded = yield* seedRuleFixtures;
        const ruleId = yield* GitHubSyncRuleId.generate;

        const result = yield* db
          .insert(schema.githubSyncRuleTable)
          .values({
            id: ruleId,
            organizationId: seeded.organizationId,
            connectionId: seeded.connectionId,
            issueMatchMode: "all",
            issueState: "open",
            postStatusId: seeded.postStatusId,
            upvoterNotificationPolicy: "notify_upvoters",
            enabled: true,
          })
          .pipe(
            Effect.match({
              onFailure: (error) => error._tag,
              onSuccess: () => "success",
            })
          );

        expect(result).toBe("EffectDrizzleQueryError");
      })
    );

    it.effect("rejects a duplicate rule shape at the database level", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const seeded = yield* seedRuleFixtures;
        const firstId = yield* GitHubSyncRuleId.generate;
        const secondId = yield* GitHubSyncRuleId.generate;
        const ruleRow = {
          organizationId: seeded.organizationId,
          connectionId: seeded.connectionId,
          issueMatchMode: "all" as const,
          issueState: "closed" as const,
          postStatusId: seeded.postStatusId,
          upvoterNotificationPolicy: "notify_upvoters" as const,
          enabled: true,
        };

        yield* db.insert(schema.githubSyncRuleTable).values({
          id: firstId,
          ...ruleRow,
        });
        const result = yield* db
          .insert(schema.githubSyncRuleTable)
          .values({ id: secondId, ...ruleRow })
          .pipe(
            Effect.match({
              onFailure: (error) => error._tag,
              onSuccess: () => "success",
            })
          );

        expect(result).toBe("EffectDrizzleQueryError");
      })
    );
  });
});
