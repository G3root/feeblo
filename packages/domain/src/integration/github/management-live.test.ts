import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { IntegrationProviderKey } from "@feeblo/db/validation-schema/integration";
import {
  BoardId,
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
import { EmailOutboxConfig } from "../../email-outbox/config";
import { BadRequestError, InternalServerError } from "../../rpc-errors";
import { ExternalResourceServiceLive } from "../external-resource/live";
import { GitHubIntegrationConfig } from "./config";
import { GitHubProvider, type GitHubProviderShape } from "./github-provider";
import { GitHubManagementServiceLive } from "./management-live";
import { GitHubManagementService } from "./management-service";
import type { GitHubResolvedIssue } from "./schema";

/** Recording fake provider; the test sets `createIssue` behavior per scenario. */
const makeFakeGitHubProvider = () => {
  const calls: string[] = [];
  let createIssueImpl: GitHubProviderShape["createIssue"] = () =>
    Effect.die("createIssue not configured");
  return {
    calls,
    reset: () => {
      calls.length = 0;
    },
    setCreateIssue: (impl: GitHubProviderShape["createIssue"]) => {
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
    oauthRedirectUrl: "http://localhost:3000/github/oauth/callback",
    webhookUrl: "http://localhost:3000/github/webhook",
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
            .select({ id: schema.externalResourceCreateRequestTable.id })
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
          expect(request).toBeUndefined();

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
});
