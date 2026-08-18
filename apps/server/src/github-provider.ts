import { timingSafeEqual } from "node:crypto";

import {
  currentDb,
  gitHubIssueSafeMetadataConditions,
  schema,
} from "@feeblo/db";
import { GitHubIntegrationConfig } from "@feeblo/domain/integration/github/config";
import { GitHubProvider } from "@feeblo/domain/integration/github/github-provider";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from "@feeblo/domain/rpc-errors";
import { IntegrationConnectionId } from "@feeblo/id";
import {
  IntegrationOAuthState,
  IntegrationProviderAuthenticationError,
  IntegrationProviderInvalidConfigurationError,
  IntegrationProviderPermanentRejection,
} from "@feeblo/integration-core";
import {
  createGitHubAppJwt,
  decryptGitHubCredentialMaterial,
  encryptGitHubCredentialMaterial,
  type GitHubUserInstallation,
  makeGitHubApiClient,
  makeGitHubInstallationTokenResolver,
  renderGitHubIssueBody,
  renderGitHubIssueTitle,
} from "@feeblo/integration-github";
import { githubProviderKey } from "@feeblo/integration-github/manifest";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { ServerConfig } from "./config";

/** Server-owned GitHub App adapter. Durable state is installation identity only; all bearer tokens are ephemeral. */
export const GitHubProviderLive = Layer.effect(
  GitHubProvider,
  Effect.gen(function* () {
    const db = yield* currentDb;
    const config = yield* ServerConfig;
    const domainConfig = yield* GitHubIntegrationConfig;
    const api = makeGitHubApiClient();
    const installationTokens = yield* makeGitHubInstallationTokenResolver({
      apiClient: api,
      appId: config.githubAppId ?? "",
      privateKey: config.githubPrivateKey,
    });
    const integrationKey = config.githubEncryptionKey;
    const providerFailure = (operation: string) =>
      new InternalServerError({ message: `GitHub App ${operation} failed.` });
    const issueFailure = (operation: string) => (failure: unknown) => {
      if (Schema.is(NotFoundError)(failure)) {
        return new NotFoundError({
          message: `GitHub resource was not found during ${operation}.`,
        });
      }
      if (Schema.is(IntegrationProviderAuthenticationError)(failure)) {
        return new UnauthorizedError({
          message: `GitHub authentication failed during ${operation}.`,
        });
      }
      if (Schema.is(IntegrationProviderInvalidConfigurationError)(failure)) {
        return new NotFoundError({
          message: `GitHub resource was not found during ${operation}.`,
        });
      }
      if (Schema.is(IntegrationProviderPermanentRejection)(failure)) {
        return new BadRequestError({
          message: `GitHub rejected ${operation}.`,
        });
      }
      // Rate-limited and temporary/transport failures are indeterminate: the
      // issue may already exist, so callers must retain idempotency state.
      return providerFailure(operation);
    };
    const installationIdForConnection = (connectionId: string) =>
      Effect.gen(function* () {
        const [installation] = yield* db
          .select({
            installationId: schema.githubInstallationTable.installationId,
          })
          .from(schema.githubInstallationTable)
          .where(eq(schema.githubInstallationTable.connectionId, connectionId))
          .limit(1)
          .pipe(Effect.mapError(() => providerFailure("installation lookup")));
        if (installation === undefined) {
          return yield* new NotFoundError({
            message: "GitHub App installation was not found.",
          });
        }
        return installation.installationId;
      });
    const installationTokenForConnection = (connectionId: string) =>
      Effect.gen(function* () {
        const installationId = yield* installationIdForConnection(connectionId);
        // Typed token failures reach issueFailure unchanged so auth failures
        // stay Unauthorized and missing installations stay NotFound.
        return yield* installationTokens.getInstallationAccessToken({
          installationId,
        });
      });
    const provider = GitHubProvider.of({
      startInstallation: (organizationId) =>
        Effect.gen(function* () {
          if (!domainConfig.configured || config.githubAppSlug === undefined) {
            return yield* new InternalServerError({
              message: "GitHub App integration is not configured.",
            });
          }
          const id = yield* IntegrationConnectionId.generate.pipe(
            Effect.mapError(() => providerFailure("connection id generation"))
          );
          const nonce = yield* Effect.try({
            try: () => crypto.randomUUID(),
            catch: () => providerFailure("installation state generation"),
          });
          const state = yield* Schema.encodeEffect(
            Schema.fromJsonString(IntegrationOAuthState)
          )({ connectionId: id, organizationId, nonce }).pipe(
            Effect.mapError(() =>
              providerFailure("installation state encoding")
            )
          );
          const ciphertext = yield* encryptGitHubCredentialMaterial(
            integrationKey,
            {
              installationState: nonce,
            }
          ).pipe(
            Effect.mapError(() =>
              providerFailure("installation state encryption")
            )
          );
          yield* db
            .insert(schema.integrationConnectionTable)
            .values({
              id,
              organizationId,
              provider: githubProviderKey,
              name: "GitHub",
              lifecycle: "connecting",
              credentialGeneration: 1,
              credentialsCiphertext: ciphertext,
              safeDisplayMetadata: {},
            })
            .pipe(
              Effect.mapError(() => providerFailure("connection creation"))
            );
          const installUrl = new URL(
            `https://github.com/apps/${encodeURIComponent(config.githubAppSlug)}/installations/new`
          );
          installUrl.searchParams.set("state", state);
          return { authorizeUrl: installUrl };
        }),
      completeInstallation: (input) =>
        Effect.gen(function* () {
          if (config.githubClientId === undefined || !domainConfig.configured) {
            return yield* new InternalServerError({
              message: "GitHub App integration is not configured.",
            });
          }
          const parsed = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(IntegrationOAuthState)
          )(input.state).pipe(
            Effect.mapError(() =>
              providerFailure("installation state validation")
            )
          );
          const [connection] = yield* db
            .select()
            .from(schema.integrationConnectionTable)
            .where(
              and(
                eq(schema.integrationConnectionTable.id, parsed.connectionId),
                eq(
                  schema.integrationConnectionTable.organizationId,
                  parsed.organizationId
                ),
                eq(
                  schema.integrationConnectionTable.provider,
                  githubProviderKey
                ),
                eq(schema.integrationConnectionTable.lifecycle, "connecting")
              )
            )
            .limit(1)
            .pipe(
              Effect.mapError(() =>
                providerFailure("installation connection lookup")
              )
            );
          if (
            connection?.credentialsCiphertext === null ||
            connection?.credentialsCiphertext === undefined
          ) {
            return yield* providerFailure("installation connection lookup");
          }
          const credentialsCiphertext = connection.credentialsCiphertext;
          const pending = yield* decryptGitHubCredentialMaterial(
            integrationKey,
            connection.credentialsCiphertext
          ).pipe(
            Effect.mapError(() =>
              providerFailure("installation state decryption")
            )
          );
          const expectedState = Buffer.from(pending.installationState ?? "");
          const receivedState = Buffer.from(parsed.nonce);
          if (
            expectedState.length === 0 ||
            expectedState.length !== receivedState.length ||
            !timingSafeEqual(expectedState, receivedState)
          ) {
            return yield* providerFailure("installation state validation");
          }
          const userToken = yield* api
            .exchangeUserAccessToken({
              clientId: config.githubClientId,
              clientSecret: config.githubClientSecret,
              code: input.code,
            })
            .pipe(
              Effect.mapError(() => providerFailure("installer token exchange"))
            );
          const installerAccessToken = Redacted.make(userToken.access_token);
          let installation: GitHubUserInstallation | undefined;
          for (let page = 1; installation === undefined; page += 1) {
            const accessible = yield* api
              .listUserInstallations({
                accessToken: installerAccessToken,
                page,
              })
              .pipe(
                Effect.mapError(() =>
                  providerFailure("installer installation verification")
                )
              );
            installation = accessible.installations.find(
              (candidate) => String(candidate.id) === input.installationId
            );
            if (
              installation !== undefined ||
              accessible.installations.length < 100 ||
              page * 100 >= accessible.total_count
            ) {
              break;
            }
          }
          if (installation === undefined) {
            return yield* new NotFoundError({
              message:
                "GitHub App installation is not accessible to the installer.",
            });
          }
          if (installation.account === null) {
            return yield* new NotFoundError({
              message: "GitHub App installation account is unavailable.",
            });
          }
          const installationAccount = installation.account;
          yield* db
            .transaction(() =>
              Effect.gen(function* () {
                const [existingInstallation] = yield* db
                  .select({
                    connectionId: schema.githubInstallationTable.connectionId,
                  })
                  .from(schema.githubInstallationTable)
                  .where(
                    eq(
                      schema.githubInstallationTable.installationId,
                      input.installationId
                    )
                  )
                  .limit(1)
                  .pipe(
                    Effect.mapError(() =>
                      providerFailure("installation lookup")
                    )
                  );
                const reusedConnectionId =
                  existingInstallation === undefined ||
                  existingInstallation.connectionId === connection.id
                    ? undefined
                    : existingInstallation.connectionId;
                if (reusedConnectionId !== undefined) {
                  const [reusedConnection] = yield* db
                    .select()
                    .from(schema.integrationConnectionTable)
                    .where(
                      and(
                        eq(
                          schema.integrationConnectionTable.id,
                          reusedConnectionId
                        ),
                        eq(
                          schema.integrationConnectionTable.organizationId,
                          parsed.organizationId
                        ),
                        eq(
                          schema.integrationConnectionTable.provider,
                          githubProviderKey
                        )
                      )
                    )
                    .limit(1)
                    .for("update")
                    .pipe(
                      Effect.mapError(() =>
                        providerFailure("installation connection lookup")
                      )
                    );
                  if (
                    reusedConnection === undefined ||
                    reusedConnection.lifecycle === "connecting"
                  ) {
                    return yield* providerFailure(
                      "installation state validation"
                    );
                  }
                  yield* db
                    .update(schema.integrationConnectionTable)
                    .set({
                      archivedAt: null,
                      credentialsCiphertext: null,
                      lifecycle:
                        installation.suspended_at === null
                          ? "active"
                          : "paused",
                      remoteAccountId: installationAccount.login,
                      retentionExpiresAt: null,
                      safeDisplayMetadata: {
                        login: installationAccount.login,
                      },
                      updatedAt: new Date(),
                    })
                    .where(
                      eq(
                        schema.integrationConnectionTable.id,
                        reusedConnection.id
                      )
                    )
                    .pipe(
                      Effect.mapError(() =>
                        providerFailure("connection reactivation")
                      )
                    );
                  yield* db
                    .delete(schema.integrationConnectionTable)
                    .where(
                      eq(schema.integrationConnectionTable.id, connection.id)
                    )
                    .pipe(
                      Effect.mapError(() =>
                        providerFailure("installation connection cleanup")
                      )
                    );
                  yield* db
                    .insert(schema.githubInstallationTable)
                    .values({
                      connectionId: reusedConnection.id,
                      installationId: input.installationId,
                      accountId: String(installationAccount.id),
                      accountLogin: installationAccount.login,
                      accountType: installationAccount.type,
                      suspendedAt: installation.suspended_at,
                    })
                    .onConflictDoUpdate({
                      target: schema.githubInstallationTable.connectionId,
                      set: {
                        installationId: input.installationId,
                        accountId: String(installationAccount.id),
                        accountLogin: installationAccount.login,
                        accountType: installationAccount.type,
                        suspendedAt: installation.suspended_at,
                      },
                    })
                    .pipe(
                      Effect.mapError(() =>
                        providerFailure("installation persistence")
                      )
                    );
                  return;
                }
                const activated = yield* db
                  .update(schema.integrationConnectionTable)
                  .set({
                    credentialsCiphertext: null,
                    lifecycle:
                      installation.suspended_at === null ? "active" : "paused",
                    remoteAccountId: installationAccount.login,
                    safeDisplayMetadata: { login: installationAccount.login },
                  })
                  .where(
                    and(
                      eq(schema.integrationConnectionTable.id, connection.id),
                      eq(
                        schema.integrationConnectionTable.lifecycle,
                        "connecting"
                      ),
                      eq(
                        schema.integrationConnectionTable.credentialsCiphertext,
                        credentialsCiphertext
                      )
                    )
                  )
                  .returning({ id: schema.integrationConnectionTable.id })
                  .pipe(
                    Effect.mapError(() =>
                      providerFailure("connection activation")
                    )
                  );
                if (activated.length === 0) {
                  return yield* providerFailure(
                    "installation state validation"
                  );
                }
                yield* db
                  .insert(schema.githubInstallationTable)
                  .values({
                    connectionId: connection.id,
                    installationId: input.installationId,
                    accountId: String(installationAccount.id),
                    accountLogin: installationAccount.login,
                    accountType: installationAccount.type,
                    suspendedAt: installation.suspended_at,
                  })
                  .onConflictDoUpdate({
                    target: schema.githubInstallationTable.connectionId,
                    set: {
                      installationId: input.installationId,
                      accountId: String(installationAccount.id),
                      accountLogin: installationAccount.login,
                      accountType: installationAccount.type,
                      suspendedAt: installation.suspended_at,
                    },
                  })
                  .pipe(
                    Effect.mapError(() =>
                      providerFailure("installation persistence")
                    )
                  );
              })
            )
            .pipe(
              Effect.mapError(() =>
                providerFailure("installation activation transaction")
              )
            );
          return { organizationId: connection.organizationId };
        }),
      listRepositories: ({ connectionId }) =>
        Effect.gen(function* () {
          const accessToken =
            yield* installationTokenForConnection(connectionId);
          const repositories: Array<{
            readonly fullName: string;
            readonly name: string;
            readonly owner: string;
            readonly private: boolean;
          }> = [];
          const maximumRepositoryPages = 100;
          for (let page = 1; page <= maximumRepositoryPages; page += 1) {
            const result = yield* api
              .listInstallationRepositories({ accessToken, page })
              .pipe(
                Effect.mapError(() => providerFailure("repository listing"))
              );
            repositories.push(
              ...result.repositories.map((repository) => ({
                fullName: repository.full_name,
                name: repository.name,
                owner: repository.owner.login,
                private: repository.private,
              }))
            );
            if (result.repositories.length === 0) {
              return repositories;
            }
            if (
              repositories.length >= result.total_count ||
              result.repositories.length < 100
            ) {
              return repositories;
            }
          }
          return repositories;
        }).pipe(
          // installationTokenForConnection keeps its typed failures so a
          // missing installation stays NotFound and token auth failures map
          // through issueFailure like every other GitHub RPC.
          Effect.mapError(issueFailure("repository listing"))
        ),
      uninstallInstallation: ({ connectionId }) =>
        Effect.gen(function* () {
          const installationId =
            yield* installationIdForConnection(connectionId);
          const appJwt = yield* createGitHubAppJwt({
            appId: config.githubAppId ?? "",
            now: new Date(),
            privateKey: config.githubPrivateKey,
          }).pipe(Effect.mapError(() => providerFailure("App authentication")));
          yield* api
            .deleteInstallation({ appJwt, installationId })
            .pipe(
              Effect.mapError(() => providerFailure("installation removal"))
            );
        }),
      createIssue: (input) =>
        installationTokenForConnection(input.connectionId).pipe(
          Effect.flatMap((accessToken) =>
            Effect.gen(function* () {
              const issue = yield* api.createIssue({
                accessToken,
                repositoryOwner: input.repositoryOwner,
                repositoryName: input.repositoryName,
                title: renderGitHubIssueTitle({ title: input.postTitle }),
                body: renderGitHubIssueBody({
                  description: input.postDescription,
                  postUrl: input.postUrl.toString(),
                }),
              });
              // The Feeblo backlink lives in a bot comment, matching the
              // link-existing-issue flow and the automatic delivery path.
              yield* api.createIssueBacklinkComment({
                accessToken,
                backlinkUrl: input.postUrl,
                issueNumber: issue.number,
                repositoryName: input.repositoryName,
                repositoryOwner: input.repositoryOwner,
              });
              return issue;
            })
          ),
          Effect.map((issue) => ({
            connectionId: input.connectionId,
            remoteId: issue.node_id,
            repositoryOwner: input.repositoryOwner,
            repositoryName: input.repositoryName,
            issueNumber: issue.number,
            issueUrl: issue.html_url,
            issueState: issue.state,
            title: issue.title,
          })),
          Effect.mapError(issueFailure("issue creation"))
        ),
      resolveIssue: (input) =>
        installationTokenForConnection(input.connectionId).pipe(
          Effect.flatMap((accessToken) =>
            Effect.gen(function* () {
              const issue = yield* api.getIssue({
                accessToken,
                repositoryOwner: input.repositoryOwner,
                repositoryName: input.repositoryName,
                issueNumber: input.issueNumber,
              });
              const existingLink = yield* db
                .select({ id: schema.postExternalResourceLinkTable.id })
                .from(schema.postExternalResourceLinkTable)
                .innerJoin(
                  schema.integrationExternalResourceTable,
                  eq(
                    schema.integrationExternalResourceTable.id,
                    schema.postExternalResourceLinkTable.externalResourceId
                  )
                )
                .where(
                  and(
                    eq(
                      schema.postExternalResourceLinkTable.postId,
                      input.postId
                    ),
                    eq(
                      schema.integrationExternalResourceTable.connectionId,
                      input.connectionId
                    ),
                    ...gitHubIssueSafeMetadataConditions({
                      issueNumber: input.issueNumber,
                      repositoryName: input.repositoryName,
                      repositoryOwner: input.repositoryOwner,
                    })
                  )
                )
                .limit(1)
                .pipe(
                  Effect.mapError(() => providerFailure("issue link lookup"))
                );
              if (existingLink.length === 0) {
                yield* api.createIssueBacklinkComment({
                  accessToken,
                  backlinkUrl: input.postUrl,
                  repositoryOwner: input.repositoryOwner,
                  repositoryName: input.repositoryName,
                  issueNumber: input.issueNumber,
                });
              }
              return issue;
            })
          ),
          Effect.map((issue) => ({
            connectionId: input.connectionId,
            remoteId: issue.node_id,
            repositoryOwner: input.repositoryOwner,
            repositoryName: input.repositoryName,
            issueNumber: issue.number,
            issueUrl: issue.html_url,
            issueState: issue.state,
            title: issue.title,
          })),
          Effect.mapError(issueFailure("issue linking"))
        ),
    });
    return provider;
  })
);
