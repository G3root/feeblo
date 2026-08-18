import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { AuthMiddleware } from "../../session-middleware";
import { PostExternalResourceLink } from "../external-resource/schema";
import { GitHubIntegrationErrors } from "./errors";
import * as S from "./schema";

/** Authenticated RPC surface for GitHub connection, issue publishing, and issue-state rules. */
export class GitHubManagementRpcs extends RpcGroup.make(
  Rpc.make("GitHubIntegrationStatus", {
    success: S.GitHubIntegrationStatus,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("GitHubConnectionList", {
    success: Schema.Array(S.GitHubConnection),
    payload: S.GitHubConnectionList,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("GitHubConnectStart", {
    success: S.GitHubConnectStarted,
    payload: S.GitHubConnectStart,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("GitHubConnectionDisconnect", {
    success: Schema.Void,
    payload: S.GitHubConnectionDisconnect,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("GitHubRepositoryList", {
    success: Schema.Array(S.GitHubRepository),
    payload: S.GitHubRepositoryList,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("GitHubSettingsGet", {
    success: S.GitHubPublishSettings,
    payload: S.GitHubSettingsGet,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("GitHubSettingsUpdate", {
    success: S.GitHubPublishSettings,
    payload: S.GitHubSettingsUpdate,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("GitHubRuleList", {
    success: Schema.Array(S.GitHubSyncRule),
    payload: S.GitHubRuleList,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("GitHubRuleCreate", {
    success: S.GitHubSyncRule,
    payload: S.GitHubRuleCreate,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("GitHubRuleUpdate", {
    success: S.GitHubSyncRule,
    payload: S.GitHubRuleUpdate,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("GitHubRuleDelete", {
    success: Schema.Void,
    payload: S.GitHubRuleDelete,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("GitHubPostIssueCreate", {
    success: PostExternalResourceLink,
    payload: S.GitHubPostIssueCreate,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("GitHubPostIssueLink", {
    success: PostExternalResourceLink,
    payload: S.GitHubPostIssueLink,
    error: GitHubIntegrationErrors,
  }).middleware(AuthMiddleware)
) {}
