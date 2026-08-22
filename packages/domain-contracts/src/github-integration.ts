import * as S from "effect/Schema";

/** Account kinds GitHub can own an App installation for. */
export const GitHubInstallationAccountType = S.Literals([
  "User",
  "Organization",
]);
export type TGitHubInstallationAccountType = S.Schema.Type<
  typeof GitHubInstallationAccountType
>;

/** GitHub issue state accepted from GitHub webhook payloads. */
export const GitHubIssueState = S.Literals(["open", "closed"]);
export type TGitHubIssueState = S.Schema.Type<typeof GitHubIssueState>;

/** Selects whether every or at least one linked issue must match a rule. */
export const GitHubIssueMatchMode = S.Literals(["all", "any"]);
export type TGitHubIssueMatchMode = S.Schema.Type<typeof GitHubIssueMatchMode>;

/** Scope used by an automatic GitHub issue publishing route. */
export const GitHubPublishBoardScope = S.Literals([
  "any_board",
  "specific_board",
]);
export type TGitHubPublishBoardScope = S.Schema.Type<
  typeof GitHubPublishBoardScope
>;

/** Notification policy for a status transition caused by a GitHub issue. */
export const GitHubUpvoterNotificationPolicy = S.Literals([
  "notify_upvoters",
  "do_not_notify_upvoters",
]);
export type TGitHubUpvoterNotificationPolicy = S.Schema.Type<
  typeof GitHubUpvoterNotificationPolicy
>;

/**
 * The two supported GitHub sync rule shapes: (any, open) fires when any linked
 * issue is open, (all, closed) fires only when every linked issue is closed.
 * They can never match the same issue aggregate, so at most one rule applies.
 */
export const isGitHubSyncRuleCombination = (
  issueMatchMode: TGitHubIssueMatchMode,
  issueState: TGitHubIssueState
): boolean =>
  (issueMatchMode === "any" && issueState === "open") ||
  (issueMatchMode === "all" && issueState === "closed");

/** A repository and optional Feeblo board selection for automatic issue creation. */
export const GitHubIssueCreateRouteConfiguration = S.Struct({
  version: S.Literal(1),
  repositoryOwner: S.NonEmptyString,
  repositoryName: S.NonEmptyString,
  boardId: S.optionalKey(S.NonEmptyString),
});
export type TGitHubIssueCreateRouteConfiguration = S.Schema.Type<
  typeof GitHubIssueCreateRouteConfiguration
>;
