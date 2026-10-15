import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { AuthMiddleware } from "../../session-middleware";
import { PostExternalResourceLink } from "../external-resource/schema";
import { GitHubIntegrationErrors } from "./errors";
import * as S from "./schema";

/** Authenticated RPC surface for GitHub connection, issue publishing, and issue-state rules. */
export class GitHubManagementRpcs extends RpcGroup.make(
  Rpc.make("GetGitHubIntegrationStatus", {
    success: S.GitHubIntegrationStatus,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ListGitHubConnections", {
    success: Schema.Array(S.GitHubConnection),
    payload: S.GitHubConnectionList,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("StartGitHubConnect", {
    success: S.GitHubConnectStarted,
    payload: S.GitHubConnectStart,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("DisconnectGitHubConnection", {
    success: Schema.Void,
    payload: S.GitHubConnectionDisconnect,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ListGitHubRepositories", {
    success: Schema.Array(S.GitHubRepository),
    payload: S.GitHubRepositoryList,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("GetGitHubSettings", {
    success: S.GitHubPublishSettings,
    payload: S.GitHubSettingsGet,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("UpdateGitHubSettings", {
    success: S.GitHubPublishSettings,
    payload: S.GitHubSettingsUpdate,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ListGitHubRules", {
    success: Schema.Array(S.GitHubSyncRule),
    payload: S.GitHubRuleList,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("CreateGitHubRule", {
    success: S.GitHubSyncRule,
    payload: S.GitHubRuleCreate,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("UpdateGitHubRule", {
    success: S.GitHubSyncRule,
    payload: S.GitHubRuleUpdate,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("DeleteGitHubRule", {
    success: Schema.Void,
    payload: S.GitHubRuleDelete,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("CreateGitHubPostIssue", {
    success: PostExternalResourceLink,
    payload: S.GitHubPostIssueCreate,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("LinkGitHubPostIssue", {
    success: PostExternalResourceLink,
    payload: S.GitHubPostIssueLink,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware)
) {}
