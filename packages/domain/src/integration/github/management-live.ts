import { currentDb, schema } from "@feeblo/db";
import {
  IntegrationExternalResourceType,
  IntegrationProviderKey,
} from "@feeblo/db/validation-schema/integration";
import {
  asLegid,
  GitHubSyncRuleId,
  IntegrationConnectionId,
  IntegrationRouteId,
  PostStatusId,
} from "@feeblo/id";
import { githubIssueCreateCapabilityKey } from "@feeblo/integration-github/manifest";
import { and, eq, ne } from "drizzle-orm";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { EmailOutboxConfig } from "../../email-outbox/config";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from "../../rpc-errors";
import type {
  ExternalResourceRecord,
  PostExternalResourceLink,
  RecordedPostExternalResourceLink,
  RecordPostExternalResourceLink,
} from "../external-resource/schema";
import { ExternalResourceService } from "../external-resource/service";
import { GitHubIntegrationConfig } from "./config";
import { GitHubProvider } from "./github-provider";
import {
  GitHubManagementService,
  type GitHubManagementServiceShape,
} from "./management-service";
import { GitHubIssueCreateRouteConfiguration } from "./schema";

const databaseError = (operation: string) => () =>
  new InternalServerError({
    message: `GitHub integration database ${operation} failed.`,
  });

/** Failures that prove GitHub never created the issue, so the reservation can be released. */
const isDefinitelyNonApplied = (error: unknown): boolean =>
  Schema.is(UnauthorizedError)(error) ||
  Schema.is(NotFoundError)(error) ||
  Schema.is(BadRequestError)(error);

const shouldReleaseCreation = <E>(cause: Cause.Cause<E>): boolean =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () => false,
    onSome: (error) => isDefinitelyNonApplied(error),
  });

/** Database-backed GitHub management service. GitHubProvider owns App installation and GitHub API I/O. */
const makeGitHubManagementService = Effect.gen(function* () {
  const db = yield* currentDb;
  const provider = yield* GitHubProvider;
  const config = yield* GitHubIntegrationConfig;
  const emailConfig = yield* EmailOutboxConfig;
  const externalResources = yield* ExternalResourceService;
  const requireConnection = (organizationId: string, connectionId: string) =>
    db
      .select()
      .from(schema.integrationConnectionTable)
      .where(
        and(
          eq(schema.integrationConnectionTable.organizationId, organizationId),
          eq(schema.integrationConnectionTable.id, connectionId),
          eq(
            schema.integrationConnectionTable.provider,
            IntegrationProviderKey.make("github")
          ),
          eq(schema.integrationConnectionTable.lifecycle, "active")
        )
      )
      .limit(1)
      .pipe(
        Effect.mapError(databaseError("connection lookup")),
        Effect.flatMap((rows) =>
          rows[0] === undefined
            ? new NotFoundError({
                message: "Active GitHub integration connection was not found.",
              })
            : Effect.succeed(rows[0])
        )
      );
  const lockConnection = (organizationId: string, connectionId: string) =>
    db
      .select()
      .from(schema.integrationConnectionTable)
      .where(
        and(
          eq(schema.integrationConnectionTable.organizationId, organizationId),
          eq(schema.integrationConnectionTable.id, connectionId),
          eq(
            schema.integrationConnectionTable.provider,
            IntegrationProviderKey.make("github")
          )
        )
      )
      .limit(1)
      .for("update");
  const loadCanonicalPostUrl = (organizationId: string, postId: string) =>
    db
      .select({
        postSlug: schema.postTable.slug,
        postTitle: schema.postTable.title,
        boardSlug: schema.boardTable.slug,
      })
      .from(schema.postTable)
      .innerJoin(
        schema.boardTable,
        eq(schema.boardTable.id, schema.postTable.boardId)
      )
      .where(
        and(
          eq(schema.postTable.id, postId),
          eq(schema.postTable.organizationId, organizationId)
        )
      )
      .limit(1)
      .pipe(
        Effect.mapError(databaseError("post URL lookup")),
        Effect.flatMap((rows) =>
          rows[0] === undefined
            ? new NotFoundError({
                message: "Feeblo post for GitHub issue link was not found.",
              })
            : Effect.succeed({
                postUrl: new URL(
                  `/${encodeURIComponent(organizationId)}/post/${encodeURIComponent(rows[0].boardSlug)}/${encodeURIComponent(rows[0].postSlug)}`,
                  emailConfig.appUrl
                ),
                postTitle: rows[0].postTitle,
              })
        )
      );
  const recordGitHubIssueExternalResource = (input: {
    readonly issue: import("./schema").GitHubResolvedIssue;
    readonly organizationId: ExternalResourceRecord["organizationId"];
    readonly postId: RecordPostExternalResourceLink["postId"];
  }): Effect.Effect<
    {
      readonly link: PostExternalResourceLink;
      readonly externalResourceId: RecordedPostExternalResourceLink["externalResourceId"];
    },
    InternalServerError
  > =>
    Effect.gen(function* () {
      const resource: ExternalResourceRecord = {
        connectionId: input.issue.connectionId,
        displayKey: `${input.issue.repositoryOwner}/${input.issue.repositoryName}#${input.issue.issueNumber}`,
        organizationId: input.organizationId,
        remoteId: input.issue.remoteId,
        remoteUrl: input.issue.issueUrl,
        resourceType: IntegrationExternalResourceType.make("issue"),
        safeMetadata: {
          issueNumber: input.issue.issueNumber,
          repositoryName: input.issue.repositoryName,
          repositoryOwner: input.issue.repositoryOwner,
        },
        stateKey: input.issue.issueState,
        title: null,
      };
      const recorded = yield* externalResources.recordPostLink({
        postId: input.postId,
        resource,
      });
      const links = yield* externalResources.listPostLinks({
        organizationId: input.organizationId,
        postId: input.postId,
      });
      const link = links.find(
        (item) => item.id === recorded.postExternalResourceLinkId
      );
      if (link === undefined) {
        return yield* new InternalServerError({
          message:
            "GitHub external resource link was not found after recording.",
        });
      }
      return { externalResourceId: recorded.externalResourceId, link };
    });
  const service: GitHubManagementServiceShape = {
    status: () => Effect.succeed({ configured: config.configured }),
    connectStart: (input) => provider.startInstallation(input.organizationId),
    connectComplete: (input) => provider.completeInstallation(input),
    disconnect: (input) =>
      Effect.gen(function* () {
        const disconnecting = yield* db
          .transaction(() =>
            Effect.gen(function* () {
              const [connection] = yield* lockConnection(
                input.organizationId,
                input.connectionId
              ).pipe(Effect.mapError(databaseError("connection lookup")));
              if (connection === undefined) {
                return yield* new NotFoundError({
                  message: "GitHub integration connection was not found.",
                });
              }
              if (connection.lifecycle === "archived") {
                return undefined;
              }
              if (connection.lifecycle === "connecting") {
                return yield* new NotFoundError({
                  message: "GitHub integration connection was not found.",
                });
              }
              const now = new Date();
              yield* db
                .update(schema.integrationConnectionTable)
                .set({ lifecycle: "disconnecting", updatedAt: now })
                .where(
                  and(
                    eq(
                      schema.integrationConnectionTable.id,
                      input.connectionId
                    ),
                    eq(
                      schema.integrationConnectionTable.organizationId,
                      input.organizationId
                    ),
                    eq(
                      schema.integrationConnectionTable.provider,
                      IntegrationProviderKey.make("github")
                    )
                  )
                )
                .pipe(
                  Effect.mapError(
                    databaseError("connection disconnecting update")
                  )
                );
              yield* db
                .update(schema.integrationRouteTable)
                .set({ enabled: false, updatedAt: now })
                .where(
                  and(
                    eq(
                      schema.integrationRouteTable.connectionId,
                      input.connectionId
                    ),
                    eq(
                      schema.integrationRouteTable.organizationId,
                      input.organizationId
                    )
                  )
                )
                .pipe(Effect.mapError(databaseError("route disable")));
              yield* db
                .update(schema.integrationDeliveryTable)
                .set({ canceledAt: now, state: "canceled", updatedAt: now })
                .where(
                  and(
                    eq(
                      schema.integrationDeliveryTable.connectionId,
                      input.connectionId
                    ),
                    eq(
                      schema.integrationDeliveryTable.organizationId,
                      input.organizationId
                    ),
                    eq(schema.integrationDeliveryTable.state, "pending")
                  )
                )
                .pipe(Effect.mapError(databaseError("delivery cancellation")));
              return connection;
            })
          )
          .pipe(Effect.mapError(databaseError("disconnect transaction")));

        if (disconnecting === undefined) {
          return;
        }

        const uninstall = yield* Effect.exit(
          provider.uninstallInstallation({
            connectionId: input.connectionId,
          })
        );
        if (Exit.isFailure(uninstall)) {
          yield* db
            .update(schema.integrationConnectionTable)
            .set({ lifecycle: "revocation_unconfirmed", updatedAt: new Date() })
            .where(eq(schema.integrationConnectionTable.id, input.connectionId))
            .pipe(Effect.mapError(databaseError("disconnect state update")));
          return yield* Effect.failCause(uninstall.cause);
        }

        const archivedAt = new Date();
        yield* db
          .update(schema.integrationConnectionTable)
          .set({
            archivedAt,
            credentialsCiphertext: null,
            lifecycle: "archived",
            updatedAt: archivedAt,
          })
          .where(
            and(
              eq(schema.integrationConnectionTable.id, input.connectionId),
              eq(
                schema.integrationConnectionTable.organizationId,
                input.organizationId
              ),
              eq(
                schema.integrationConnectionTable.provider,
                IntegrationProviderKey.make("github")
              )
            )
          )
          .pipe(Effect.mapError(databaseError("connection removal")));
      }),
    listConnections: ({ organizationId }) =>
      db
        .select({
          id: schema.integrationConnectionTable.id,
          login: schema.githubInstallationTable.accountLogin,
          lifecycle: schema.integrationConnectionTable.lifecycle,
          createdAt: schema.integrationConnectionTable.createdAt,
        })
        .from(schema.integrationConnectionTable)
        .innerJoin(
          schema.githubInstallationTable,
          eq(
            schema.githubInstallationTable.connectionId,
            schema.integrationConnectionTable.id
          )
        )
        .where(
          and(
            eq(
              schema.integrationConnectionTable.organizationId,
              organizationId
            ),
            eq(
              schema.integrationConnectionTable.provider,
              IntegrationProviderKey.make("github")
            ),
            ne(schema.integrationConnectionTable.lifecycle, "archived")
          )
        )
        .pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              ...row,
              id: asLegid(IntegrationConnectionId)(row.id),
            }))
          ),
          Effect.mapError(databaseError("connection list"))
        ),
    listRepositories: (input) =>
      requireConnection(input.organizationId, input.connectionId).pipe(
        Effect.flatMap(() =>
          provider.listRepositories({ connectionId: input.connectionId })
        )
      ),
    getSettings: (input) =>
      requireConnection(input.organizationId, input.connectionId).pipe(
        Effect.flatMap(() =>
          db
            .select({
              config: schema.integrationRouteTable.providerConfig,
              enabled: schema.integrationRouteTable.enabled,
            })
            .from(schema.integrationRouteTable)
            .where(
              and(
                eq(
                  schema.integrationRouteTable.connectionId,
                  input.connectionId
                ),
                eq(
                  schema.integrationRouteTable.capabilityKey,
                  githubIssueCreateCapabilityKey
                )
              )
            )
            .limit(1)
        ),
        Effect.mapError(databaseError("settings read")),
        Effect.map((rows) => {
          const row = rows[0];
          const config = Schema.decodeUnknownOption(
            GitHubIssueCreateRouteConfiguration
          )(row?.config).pipe(
            Option.getOrElse(() =>
              GitHubIssueCreateRouteConfiguration.make({ version: 1 })
            )
          );
          return {
            enabled: row?.enabled ?? false,
            boardScope:
              config.boardId === undefined
                ? ("any_board" as const)
                : ("specific_board" as const),
            boardId: config.boardId ?? null,
            repositoryOwner: config.repositoryOwner ?? null,
            repositoryName: config.repositoryName ?? null,
          };
        })
      ),
    updateSettings: (input) =>
      Effect.gen(function* () {
        yield* requireConnection(input.organizationId, input.connectionId);
        if (
          input.enabled &&
          (input.repositoryOwner === null || input.repositoryName === null)
        ) {
          return yield* new InternalServerError({
            message:
              "GitHub integration enabled settings require a repository.",
          });
        }
        if (input.boardScope === "specific_board" && input.boardId === null) {
          return yield* new InternalServerError({
            message:
              "GitHub integration specific board settings require a board.",
          });
        }
        if (
          input.enabled &&
          input.repositoryOwner !== null &&
          input.repositoryName !== null
        ) {
          const repositories = yield* provider.listRepositories({
            connectionId: input.connectionId,
          });
          const selectedRepository = repositories.some(
            (repository) =>
              repository.owner === input.repositoryOwner &&
              repository.name === input.repositoryName
          );
          if (!selectedRepository) {
            return yield* new NotFoundError({
              message:
                "Selected GitHub repository is not available to this App installation.",
            });
          }
        }
        const routeId = yield* IntegrationRouteId.generate.pipe(
          Effect.mapError(databaseError("route identifier generation"))
        );
        const providerConfig = {
          version: 1,
          ...(input.boardId === null ? {} : { boardId: input.boardId }),
          ...(input.repositoryOwner === null
            ? {}
            : { repositoryOwner: input.repositoryOwner }),
          ...(input.repositoryName === null
            ? {}
            : { repositoryName: input.repositoryName }),
        };
        yield* db
          .insert(schema.integrationRouteTable)
          .values({
            id: routeId,
            organizationId: input.organizationId,
            connectionId: input.connectionId,
            capabilityKey: githubIssueCreateCapabilityKey,
            routeKey: "",
            configVersion: 1,
            enabled: input.enabled,
            eventTypes: ["feedback.post.created"],
            providerConfig,
            safeDisplayMetadata: {},
          })
          .onConflictDoUpdate({
            target: [
              schema.integrationRouteTable.connectionId,
              schema.integrationRouteTable.capabilityKey,
              schema.integrationRouteTable.routeKey,
            ],
            set: { enabled: input.enabled, providerConfig },
          })
          .pipe(Effect.mapError(databaseError("settings upsert")));
        return {
          enabled: input.enabled,
          boardScope: input.boardScope,
          boardId: input.boardId,
          repositoryOwner: input.repositoryOwner,
          repositoryName: input.repositoryName,
        };
      }),
    listRules: (input) =>
      requireConnection(input.organizationId, input.connectionId).pipe(
        Effect.flatMap(() =>
          db
            .select()
            .from(schema.githubSyncRuleTable)
            .where(
              and(
                eq(
                  schema.githubSyncRuleTable.organizationId,
                  input.organizationId
                ),
                eq(schema.githubSyncRuleTable.connectionId, input.connectionId)
              )
            )
        ),
        Effect.mapError(databaseError("rule list")),
        Effect.map((rows) =>
          rows.map((row) => ({
            id: asLegid(GitHubSyncRuleId)(row.id),
            connectionId: asLegid(IntegrationConnectionId)(row.connectionId),
            issueMatchMode: row.issueMatchMode,
            issueState: row.issueState,
            postStatusId: asLegid(PostStatusId)(row.postStatusId),
            upvoterNotificationPolicy: row.upvoterNotificationPolicy,
            enabled: row.enabled,
          }))
        )
      ),
    createRule: (input) =>
      Effect.gen(function* () {
        yield* requireConnection(input.organizationId, input.connectionId);
        const id = yield* GitHubSyncRuleId.generate.pipe(
          Effect.mapError(databaseError("rule identifier generation"))
        );
        yield* db
          .insert(schema.githubSyncRuleTable)
          .values({ ...input, id })
          .pipe(Effect.mapError(databaseError("rule creation")));
        return { ...input, id };
      }),
    updateRule: (input) =>
      db
        .update(schema.githubSyncRuleTable)
        .set({
          enabled: input.enabled,
          issueMatchMode: input.issueMatchMode,
          issueState: input.issueState,
          postStatusId: input.postStatusId,
          upvoterNotificationPolicy: input.upvoterNotificationPolicy,
        })
        .where(
          and(
            eq(schema.githubSyncRuleTable.id, input.id),
            eq(schema.githubSyncRuleTable.organizationId, input.organizationId),
            eq(schema.githubSyncRuleTable.connectionId, input.connectionId)
          )
        )
        .returning({ connectionId: schema.githubSyncRuleTable.connectionId })
        .pipe(
          Effect.mapError(databaseError("rule update")),
          Effect.flatMap((rows) =>
            rows[0] === undefined
              ? new NotFoundError({
                  message: "GitHub synchronization rule was not found.",
                })
              : Effect.succeed({
                  id: input.id,
                  connectionId: asLegid(IntegrationConnectionId)(
                    rows[0].connectionId
                  ),
                  issueMatchMode: input.issueMatchMode,
                  issueState: input.issueState,
                  postStatusId: input.postStatusId,
                  upvoterNotificationPolicy: input.upvoterNotificationPolicy,
                  enabled: input.enabled,
                })
          )
        ),
    deleteRule: (input) =>
      db
        .delete(schema.githubSyncRuleTable)
        .where(
          and(
            eq(schema.githubSyncRuleTable.id, input.id),
            eq(schema.githubSyncRuleTable.organizationId, input.organizationId),
            eq(schema.githubSyncRuleTable.connectionId, input.connectionId)
          )
        )
        .returning({ id: schema.githubSyncRuleTable.id })
        .pipe(
          Effect.mapError(databaseError("rule deletion")),
          Effect.flatMap((rows) =>
            rows[0] === undefined
              ? new NotFoundError({
                  message: "GitHub synchronization rule was not found.",
                })
              : Effect.void
          )
        ),
    createPostIssue: (input) =>
      Effect.gen(function* () {
        yield* requireConnection(input.organizationId, input.connectionId);
        const request = yield* externalResources.reserveCreation({
          connectionId: input.connectionId,
          idempotencyKey: input.idempotencyKey,
          organizationId: input.organizationId,
          postId: input.postId,
        });
        if (!request.reserved) {
          const links = yield* externalResources.listPostLinks({
            organizationId: input.organizationId,
            postId: input.postId,
          });
          const completed = links.find(
            (link) => link.id === request.postExternalResourceLinkId
          );
          if (completed !== undefined) {
            return completed;
          }
          return yield* new InternalServerError({
            message: "GitHub issue creation is already pending.",
          });
        }
        return yield* Effect.gen(function* () {
          const post = yield* loadCanonicalPostUrl(
            input.organizationId,
            input.postId
          );
          const issue = yield* provider.createIssue({
            ...input,
            postTitle: post.postTitle,
            postUrl: post.postUrl,
          });
          const recorded = yield* recordGitHubIssueExternalResource({
            issue,
            organizationId: input.organizationId,
            postId: input.postId,
          });
          yield* externalResources.completeCreation({
            externalResourceId: recorded.externalResourceId,
            postExternalResourceLinkId: recorded.link.id,
            requestId: request.id,
          });
          return recorded.link;
        }).pipe(
          Effect.onErrorIf(shouldReleaseCreation, () =>
            externalResources
              .failCreation({ requestId: request.id })
              .pipe(Effect.catch((cause) => Effect.logError(cause)))
          )
        );
      }),
    linkPostIssue: (input) =>
      Effect.gen(function* () {
        yield* requireConnection(input.organizationId, input.connectionId);
        const post = yield* loadCanonicalPostUrl(
          input.organizationId,
          input.postId
        );
        const issue = yield* provider.resolveIssue({
          ...input,
          postUrl: post.postUrl,
        });
        return (yield* recordGitHubIssueExternalResource({
          issue,
          organizationId: input.organizationId,
          postId: input.postId,
        })).link;
      }),
  };
  return GitHubManagementService.of(service);
});

/** Live service layer requiring the server-selected GitHub App API adapter. */
export const GitHubManagementServiceLive = Layer.effect(
  GitHubManagementService,
  makeGitHubManagementService
);
