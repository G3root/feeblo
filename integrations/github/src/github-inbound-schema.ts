import * as Schema from "effect/Schema";

/** GitHub App installation identifier carried by every app-scoped delivery. */
export const GitHubInstallationId = Schema.Int.check(Schema.isGreaterThan(0));
export type GitHubInstallationId = Schema.Schema.Type<
  typeof GitHubInstallationId
>;

/** Issue actions that can change Feeblo's linked-resource status. */
export const GitHubWebhookIssueAction = Schema.Literals([
  "assigned",
  "closed",
  "edited",
  "labeled",
  "locked",
  "milestoned",
  "opened",
  "reopened",
  "unassigned",
  "unlabeled",
  "unlocked",
  "demilestoned",
]);
export type GitHubWebhookIssueAction = Schema.Schema.Type<
  typeof GitHubWebhookIssueAction
>;

/** Safe subset of an Issues webhook delivered to a GitHub App. */
export const GitHubIssueWebhookPayload = Schema.Struct({
  action: GitHubWebhookIssueAction,
  installation: Schema.Struct({ id: GitHubInstallationId }),
  issue: Schema.Struct({
    html_url: Schema.URLFromString,
    id: Schema.Number,
    node_id: Schema.String,
    number: Schema.Int,
    state: Schema.Literals(["open", "closed"]),
    title: Schema.String,
  }),
  repository: Schema.Struct({
    full_name: Schema.NonEmptyString,
    id: Schema.Number,
    name: Schema.NonEmptyString,
    owner: Schema.Struct({ login: Schema.NonEmptyString }),
  }),
  sender: Schema.Struct({
    id: Schema.Number,
    login: Schema.NonEmptyString,
  }),
});
export type GitHubIssueWebhookPayload = Schema.Schema.Type<
  typeof GitHubIssueWebhookPayload
>;

/** GitHub App lifecycle actions Feeblo persists for an installation. */
export const GitHubInstallationWebhookAction = Schema.Literals([
  "created",
  "deleted",
  "suspend",
  "unsuspend",
]);
export type GitHubInstallationWebhookAction = Schema.Schema.Type<
  typeof GitHubInstallationWebhookAction
>;

/** Safe subset of an Installation webhook used to enable or disable a connection. */
export const GitHubInstallationWebhookPayload = Schema.Struct({
  action: GitHubInstallationWebhookAction,
  installation: Schema.Struct({ id: GitHubInstallationId }),
});
export type GitHubInstallationWebhookPayload = Schema.Schema.Type<
  typeof GitHubInstallationWebhookPayload
>;

/** Repository-selection updates are acknowledged so GitHub can retry neither stale nor unsupported deliveries. */
export const GitHubInstallationRepositoriesWebhookPayload = Schema.Struct({
  action: Schema.Literals(["added", "removed"]),
  installation: Schema.Struct({ id: GitHubInstallationId }),
});
export type GitHubInstallationRepositoriesWebhookPayload = Schema.Schema.Type<
  typeof GitHubInstallationRepositoriesWebhookPayload
>;

/** Verified and decoded inbound GitHub App delivery, keyed by GitHub's delivery ID. */
export const ParsedGitHubInboundRequest = Schema.Union([
  Schema.Struct({
    deliveryId: Schema.NonEmptyString,
    kind: Schema.Literal("issue"),
    payload: GitHubIssueWebhookPayload,
  }),
  Schema.Struct({
    deliveryId: Schema.NonEmptyString,
    kind: Schema.Literal("installation"),
    payload: GitHubInstallationWebhookPayload,
  }),
  Schema.Struct({
    deliveryId: Schema.NonEmptyString,
    kind: Schema.Literal("installation_repositories"),
    payload: GitHubInstallationRepositoriesWebhookPayload,
  }),
]);
export type ParsedGitHubInboundRequest = Schema.Schema.Type<
  typeof ParsedGitHubInboundRequest
>;
