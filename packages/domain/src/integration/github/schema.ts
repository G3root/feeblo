import {
  GitHubIssueMatchMode,
  GitHubIssueState,
  GitHubPublishBoardScope,
  GitHubUpvoterNotificationPolicy,
} from "@feeblo/db/validation-schema/github-integration";
import { IntegrationConnectionLifecycleStatus } from "@feeblo/db/validation-schema/integration";
import {
  BoardId,
  GitHubSyncRuleId,
  IntegrationConnectionId,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import * as Schema from "effect/Schema";

/** Safe GitHub App installation details; installation access tokens are never persisted. */
export const GitHubConnection = Schema.Struct({
  id: IntegrationConnectionId.schema,
  login: Schema.NullOr(Schema.String),
  lifecycle: IntegrationConnectionLifecycleStatus,
  createdAt: Schema.DateFromString,
});
export type GitHubConnection = Schema.Schema.Type<typeof GitHubConnection>;

/** A repository available to the authenticated GitHub integration connection. */
export const GitHubRepository = Schema.Struct({
  owner: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  fullName: Schema.NonEmptyString,
  private: Schema.Boolean,
});
export type GitHubRepository = Schema.Schema.Type<typeof GitHubRepository>;

/** Automatic issue publishing settings stored as safe route configuration. */
export const GitHubPublishSettings = Schema.Struct({
  enabled: Schema.Boolean,
  boardScope: GitHubPublishBoardScope,
  boardId: Schema.NullOr(BoardId.schema),
  repositoryOwner: Schema.NullOr(Schema.String),
  repositoryName: Schema.NullOr(Schema.String),
});
export type GitHubPublishSettings = Schema.Schema.Type<
  typeof GitHubPublishSettings
>;

/** Persisted safe GitHub issue-create route configuration; credentials never belong here. */
export const GitHubIssueCreateRouteConfiguration = Schema.Struct({
  version: Schema.Literal(1),
  boardId: Schema.optionalKey(BoardId.schema),
  repositoryOwner: Schema.optionalKey(Schema.NonEmptyString),
  repositoryName: Schema.optionalKey(Schema.NonEmptyString),
});
export type GitHubIssueCreateRouteConfiguration = Schema.Schema.Type<
  typeof GitHubIssueCreateRouteConfiguration
>;

/** One rule that turns aggregate linked GitHub issue state into a Feeblo status. */
export const GitHubSyncRule = Schema.Struct({
  id: GitHubSyncRuleId.schema,
  connectionId: IntegrationConnectionId.schema,
  issueMatchMode: GitHubIssueMatchMode,
  issueState: GitHubIssueState,
  postStatusId: PostStatusId.schema,
  upvoterNotificationPolicy: GitHubUpvoterNotificationPolicy,
  enabled: Schema.Boolean,
});
export type GitHubSyncRule = Schema.Schema.Type<typeof GitHubSyncRule>;

/** A GitHub issue normalized by the GitHub provider before generic persistence. */
export const GitHubResolvedIssue = Schema.Struct({
  connectionId: IntegrationConnectionId.schema,
  repositoryOwner: Schema.String,
  repositoryName: Schema.String,
  issueNumber: Schema.Int,
  remoteId: Schema.NonEmptyString,
  issueUrl: Schema.URLFromString,
  issueState: GitHubIssueState,
});
export type GitHubResolvedIssue = Schema.Schema.Type<
  typeof GitHubResolvedIssue
>;

/** Starts the GitHub App installation flow. */
export const GitHubConnectStart = Schema.Struct({
  organizationId: WorkspaceId.schema,
});
export type GitHubConnectStart = Schema.Schema.Type<typeof GitHubConnectStart>;
export const GitHubConnectStarted = Schema.Struct({
  authorizeUrl: Schema.URLFromString,
});
export type GitHubConnectStarted = Schema.Schema.Type<
  typeof GitHubConnectStarted
>;

/** Actions GitHub sends to the App installation setup callback. */
export const GitHubInstallationSetupAction = Schema.Literals([
  "install",
  "update",
]);
export type GitHubInstallationSetupAction = Schema.Schema.Type<
  typeof GitHubInstallationSetupAction
>;

/** Verified App installation callback parameters. The short-lived installer token is provider-private. */
export const GitHubAppInstallationCallback = Schema.Struct({
  code: Schema.NonEmptyString,
  state: Schema.NonEmptyString,
  installationId: Schema.NonEmptyString,
  setupAction: GitHubInstallationSetupAction,
});
export type GitHubAppInstallationCallback = Schema.Schema.Type<
  typeof GitHubAppInstallationCallback
>;
export const GitHubConnectionList = Schema.Struct({
  organizationId: WorkspaceId.schema,
});
export type GitHubConnectionList = Schema.Schema.Type<
  typeof GitHubConnectionList
>;
/** Removes one GitHub App connection from Feeblo without deleting historical issue links. */
export const GitHubConnectionDisconnect = Schema.Struct({
  organizationId: WorkspaceId.schema,
  connectionId: IntegrationConnectionId.schema,
});
export type GitHubConnectionDisconnect = Schema.Schema.Type<
  typeof GitHubConnectionDisconnect
>;
export const GitHubRepositoryList = Schema.Struct({
  organizationId: WorkspaceId.schema,
  connectionId: IntegrationConnectionId.schema,
});
export type GitHubRepositoryList = Schema.Schema.Type<
  typeof GitHubRepositoryList
>;
export const GitHubSettingsGet = Schema.Struct({
  organizationId: WorkspaceId.schema,
  connectionId: IntegrationConnectionId.schema,
});
export type GitHubSettingsGet = Schema.Schema.Type<typeof GitHubSettingsGet>;
export const GitHubSettingsUpdate = Schema.Struct({
  ...GitHubSettingsGet.fields,
  ...GitHubPublishSettings.fields,
});
export type GitHubSettingsUpdate = Schema.Schema.Type<
  typeof GitHubSettingsUpdate
>;
export const GitHubRuleList = GitHubSettingsGet;
export type GitHubRuleList = Schema.Schema.Type<typeof GitHubRuleList>;
export const GitHubRuleCreate = Schema.Struct({
  ...GitHubSettingsGet.fields,
  issueMatchMode: GitHubIssueMatchMode,
  issueState: GitHubIssueState,
  postStatusId: PostStatusId.schema,
  upvoterNotificationPolicy: GitHubUpvoterNotificationPolicy,
  enabled: Schema.Boolean,
});
export type GitHubRuleCreate = Schema.Schema.Type<typeof GitHubRuleCreate>;
/** Updates the mutable fields of a hard-wired GitHub synchronization rule; the issue-state shape is fixed. */
export const GitHubRuleUpdate = Schema.Struct({
  ...GitHubSettingsGet.fields,
  id: GitHubSyncRuleId.schema,
  postStatusId: PostStatusId.schema,
  upvoterNotificationPolicy: GitHubUpvoterNotificationPolicy,
  enabled: Schema.Boolean,
});
export type GitHubRuleUpdate = Schema.Schema.Type<typeof GitHubRuleUpdate>;
export const GitHubRuleDelete = Schema.Struct({
  organizationId: WorkspaceId.schema,
  connectionId: IntegrationConnectionId.schema,
  id: GitHubSyncRuleId.schema,
});
export type GitHubRuleDelete = Schema.Schema.Type<typeof GitHubRuleDelete>;
export const GitHubPostIssueCreate = Schema.Struct({
  organizationId: WorkspaceId.schema,
  postId: PostId.schema,
  connectionId: IntegrationConnectionId.schema,
  repositoryOwner: Schema.NonEmptyString,
  repositoryName: Schema.NonEmptyString,
  idempotencyKey: Schema.NonEmptyString,
});
export type GitHubPostIssueCreate = Schema.Schema.Type<
  typeof GitHubPostIssueCreate
>;
export const GitHubPostIssueLink = Schema.Struct({
  organizationId: WorkspaceId.schema,
  postId: PostId.schema,
  connectionId: IntegrationConnectionId.schema,
  repositoryOwner: Schema.NonEmptyString,
  repositoryName: Schema.NonEmptyString,
  issueNumber: Schema.Int.check(Schema.isGreaterThan(0)),
  idempotencyKey: Schema.NonEmptyString,
});
export type GitHubPostIssueLink = Schema.Schema.Type<
  typeof GitHubPostIssueLink
>;
export const GitHubIntegrationStatus = Schema.Struct({
  configured: Schema.Boolean,
});
export type GitHubIntegrationStatus = Schema.Schema.Type<
  typeof GitHubIntegrationStatus
>;
