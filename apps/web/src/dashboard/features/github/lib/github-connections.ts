import { fetchRpc } from "~/lib/runtime";

/** Reads whether the GitHub App is configured for this deployment. */
export const loadGitHubIntegrationStatus = () =>
  fetchRpc((rpc) => rpc.GitHubIntegrationStatus()).then(
    (result) => result.configured
  );

/** Lists the safe GitHub connections belonging to an organization. */
export const loadGitHubConnections = (organizationId: string) =>
  fetchRpc((rpc) => rpc.GitHubConnectionList({ organizationId })).then(
    (result) => [...result]
  );

/** Starts the organization-scoped GitHub App installation flow. */
export const startGitHubConnect = (organizationId: string) =>
  fetchRpc((rpc) => rpc.GitHubConnectStart({ organizationId }));

/** Removes a GitHub App connection from Feeblo. */
export const disconnectGitHubConnection = (input: {
  readonly organizationId: string;
  readonly connectionId: string;
}) => fetchRpc((rpc) => rpc.GitHubConnectionDisconnect(input));

/** Lists repositories the connected GitHub account can publish issues to. */
export const loadGitHubRepositories = (input: {
  readonly organizationId: string;
  readonly connectionId: string;
}) =>
  fetchRpc((rpc) => rpc.GitHubRepositoryList(input)).then((result) => [
    ...result,
  ]);

/** Reads automatic GitHub issue publishing settings for one connection. */
export const loadGitHubPublishSettings = (input: {
  readonly organizationId: string;
  readonly connectionId: string;
}) => fetchRpc((rpc) => rpc.GitHubSettingsGet(input));

/** Updates the safe, non-secret automatic GitHub issue publishing settings. */
export const updateGitHubPublishSettings = (input: {
  readonly organizationId: string;
  readonly connectionId: string;
  readonly enabled: boolean;
  readonly boardScope: "any_board" | "specific_board";
  readonly boardId: string | null;
  readonly repositoryOwner: string | null;
  readonly repositoryName: string | null;
}) => fetchRpc((rpc) => rpc.GitHubSettingsUpdate(input));

/** Lists issue-state-to-Feeblo-status synchronization rules for one connection. */
export const loadGitHubSyncRules = (input: {
  readonly organizationId: string;
  readonly connectionId: string;
}) =>
  fetchRpc((rpc) => rpc.GitHubRuleList(input)).then((result) => [...result]);

/** Creates a GitHub issue synchronization rule. */
export const createGitHubSyncRule = (input: {
  readonly organizationId: string;
  readonly connectionId: string;
  readonly issueMatchMode: "all" | "any";
  readonly issueState: "open" | "closed";
  readonly postStatusId: string;
  readonly upvoterNotificationPolicy:
    | "notify_upvoters"
    | "do_not_notify_upvoters";
  readonly enabled: boolean;
}) => fetchRpc((rpc) => rpc.GitHubRuleCreate(input));

/** Updates a GitHub issue synchronization rule. */
export const updateGitHubSyncRule = (input: {
  readonly organizationId: string;
  readonly connectionId: string;
  readonly id: string;
  readonly issueMatchMode: "all" | "any";
  readonly issueState: "open" | "closed";
  readonly postStatusId: string;
  readonly upvoterNotificationPolicy:
    | "notify_upvoters"
    | "do_not_notify_upvoters";
  readonly enabled: boolean;
}) => fetchRpc((rpc) => rpc.GitHubRuleUpdate(input));

/** Removes a GitHub issue synchronization rule. */
export const deleteGitHubSyncRule = (input: {
  readonly organizationId: string;
  readonly connectionId: string;
  readonly id: string;
}) => fetchRpc((rpc) => rpc.GitHubRuleDelete(input));

/** Creates and links a new GitHub issue for a Feeblo post. */
export const createGitHubPostIssue = (input: {
  readonly organizationId: string;
  readonly postId: string;
  readonly connectionId: string;
  readonly repositoryOwner: string;
  readonly repositoryName: string;
  readonly idempotencyKey: string;
}) => fetchRpc((rpc) => rpc.GitHubPostIssueCreate(input));

/** Links an existing GitHub issue to a Feeblo post. */
export const linkGitHubPostIssue = (input: {
  readonly organizationId: string;
  readonly postId: string;
  readonly connectionId: string;
  readonly repositoryOwner: string;
  readonly repositoryName: string;
  readonly issueNumber: number;
  readonly idempotencyKey: string;
}) => fetchRpc((rpc) => rpc.GitHubPostIssueLink(input));

/** Lists boards for the automatic publishing scope selector. */
export const loadGitHubBoards = (organizationId: string) =>
  fetchRpc((rpc) => rpc.BoardList({ organizationId })).then((result) => [
    ...result,
  ]);

/** Lists Feeblo statuses that GitHub state synchronization rules can set. */
export const loadGitHubPostStatuses = (organizationId: string) =>
  fetchRpc((rpc) => rpc.PostStatusList({ organizationId })).then((result) => [
    ...result,
  ]);
