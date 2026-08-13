import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { PostExternalResourceLink } from "../external-resource/schema";
import type { GitHubIntegrationError } from "./errors";
import type * as S from "./schema";

/** Application-owned GitHub capability: the provider adapter implements GitHub App installation and API I/O behind this boundary. */
export interface GitHubManagementServiceShape {
  /** Completes the App setup callback; provider code verifies temporary installer access and persists no token. */
  readonly connectComplete: (
    input: S.GitHubAppInstallationCallback
  ) => Effect.Effect<
    { readonly organizationId: string },
    GitHubIntegrationError
  >;
  readonly connectStart: (
    input: S.GitHubConnectStart
  ) => Effect.Effect<S.GitHubConnectStarted, GitHubIntegrationError>;
  /** Creates exactly one issue per stable idempotency key, then persists its link. */
  readonly createPostIssue: (
    input: S.GitHubPostIssueCreate
  ) => Effect.Effect<PostExternalResourceLink, GitHubIntegrationError>;
  readonly createRule: (
    input: S.GitHubRuleCreate
  ) => Effect.Effect<S.GitHubSyncRule, GitHubIntegrationError>;
  readonly deleteRule: (
    input: S.GitHubRuleDelete
  ) => Effect.Effect<void, GitHubIntegrationError>;
  /** Archives a GitHub connection and disables its routes while retaining historical links. */
  readonly disconnect: (
    input: S.GitHubConnectionDisconnect
  ) => Effect.Effect<void, GitHubIntegrationError>;
  readonly getSettings: (
    input: S.GitHubSettingsGet
  ) => Effect.Effect<S.GitHubPublishSettings, GitHubIntegrationError>;
  /** Links one existing issue; the connection/repository/number unique key makes retries safe. */
  readonly linkPostIssue: (
    input: S.GitHubPostIssueLink
  ) => Effect.Effect<PostExternalResourceLink, GitHubIntegrationError>;
  readonly listConnections: (
    input: S.GitHubConnectionList
  ) => Effect.Effect<readonly S.GitHubConnection[], GitHubIntegrationError>;
  readonly listRepositories: (
    input: S.GitHubRepositoryList
  ) => Effect.Effect<readonly S.GitHubRepository[], GitHubIntegrationError>;
  readonly listRules: (
    input: S.GitHubRuleList
  ) => Effect.Effect<readonly S.GitHubSyncRule[], GitHubIntegrationError>;
  readonly status: () => Effect.Effect<S.GitHubIntegrationStatus, never>;
  readonly updateRule: (
    input: S.GitHubRuleUpdate
  ) => Effect.Effect<S.GitHubSyncRule, GitHubIntegrationError>;
  readonly updateSettings: (
    input: S.GitHubSettingsUpdate
  ) => Effect.Effect<S.GitHubPublishSettings, GitHubIntegrationError>;
}

/** Service key supplied by server composition after it wires the GitHub adapter. */
export class GitHubManagementService extends Context.Service<
  GitHubManagementService,
  GitHubManagementServiceShape
>()("@feeblo/GitHubManagementService") {}
